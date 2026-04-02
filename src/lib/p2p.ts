import { 
  collection, 
  doc, 
  addDoc, 
  onSnapshot, 
  updateDoc, 
  getDoc, 
  serverTimestamp,
  query,
  where
} from 'firebase/firestore';
import { db } from './firebase';

const CHUNK_SIZE = 16384; // 16KB chunks for WebRTC

export interface TransferProgress {
  fileName: string;
  fileSize: number;
  transferred: number;
  status: 'idle' | 'connecting' | 'transferring' | 'completed' | 'error';
  error?: string;
}

export class P2PTransfer {
  private peerConnection: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private roomId: string | null = null;
  private onProgress: (progress: TransferProgress) => void;
  private onFileReceived: (file: Blob, name: string) => void;
  private onConnected?: () => void;
  
  private receivedChunks: Uint8Array[] = [];
  private receivedSize = 0;
  private expectedFileName = '';
  private expectedFileSize = 0;

  constructor(
    onProgress: (progress: TransferProgress) => void,
    onFileReceived: (file: Blob, name: string) => void,
    onConnected?: () => void
  ) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };
    this.peerConnection = new RTCPeerConnection(configuration);
    this.onProgress = onProgress;
    this.onFileReceived = onFileReceived;
    this.onConnected = onConnected;

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.roomId) {
        const candidatesRef = collection(db, 'rooms', this.roomId, 'candidates');
        addDoc(candidatesRef, {
          candidate: JSON.stringify(event.candidate.toJSON()),
          type: this.dataChannel ? 'offer' : 'answer',
          createdAt: serverTimestamp(),
        });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'connected') {
        this.onConnected?.();
        this.onProgress({ 
          fileName: '', 
          fileSize: 0, 
          transferred: 0, 
          status: 'transferring' 
        });
      }
    };
  }

  async createRoom(): Promise<string> {
    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer');
    this.setupDataChannel(this.dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    const shortCode = Math.floor(100000 + Math.random() * 900000).toString();
    const roomsRef = collection(db, 'rooms');
    const roomDoc = await addDoc(roomsRef, {
      shortCode,
      offer: JSON.stringify(offer),
      status: 'waiting',
      createdAt: serverTimestamp(),
    });

    this.roomId = roomDoc.id;

    // Listen for answer
    onSnapshot(roomDoc, async (snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !this.peerConnection.currentRemoteDescription) {
        const answer = new RTCSessionDescription(JSON.parse(data.answer));
        await this.peerConnection.setRemoteDescription(answer);
      }
    });

    // Listen for ICE candidates
    const candidatesRef = collection(db, 'rooms', this.roomId, 'candidates');
    onSnapshot(candidatesRef, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.type === 'answer') {
            const candidate = new RTCIceCandidate(JSON.parse(data.candidate));
            await this.peerConnection.addIceCandidate(candidate);
          }
        }
      });
    });

    return shortCode;
  }

  async joinRoom(shortCode: string) {
    const roomsRef = collection(db, 'rooms');
    const q = query(roomsRef, where('shortCode', '==', shortCode), where('status', '==', 'waiting'));
    
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
          unsubscribe();
          reject(new Error('Room not found or already connected'));
          return;
        }

        const roomDoc = snapshot.docs[0];
        this.roomId = roomDoc.id;
        const roomRef = doc(db, 'rooms', this.roomId);
        const roomData = roomDoc.data();

        this.peerConnection.ondatachannel = (event) => {
          this.dataChannel = event.channel;
          this.setupDataChannel(this.dataChannel);
        };

        const offer = new RTCSessionDescription(JSON.parse(roomData.offer));
        await this.peerConnection.setRemoteDescription(offer);

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        await updateDoc(roomRef, {
          answer: JSON.stringify(answer),
          status: 'connected',
        });

        // Listen for ICE candidates
        const candidatesRef = collection(db, 'rooms', this.roomId, 'candidates');
        onSnapshot(candidatesRef, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const data = change.doc.data();
              if (data.type === 'offer') {
                const candidate = new RTCIceCandidate(JSON.parse(data.candidate));
                await this.peerConnection.addIceCandidate(candidate);
              }
            }
          });
        });

        unsubscribe();
        resolve();
      });
    });
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    
    channel.onopen = () => console.log('Data channel opened');
    channel.onclose = () => console.log('Data channel closed');
    
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const metadata = JSON.parse(event.data);
        if (metadata.type === 'metadata') {
          this.expectedFileName = metadata.name;
          this.expectedFileSize = metadata.size;
          this.receivedChunks = [];
          this.receivedSize = 0;
          this.onProgress({
            fileName: this.expectedFileName,
            fileSize: this.expectedFileSize,
            transferred: 0,
            status: 'transferring'
          });
        }
      } else {
        const chunk = new Uint8Array(event.data);
        this.receivedChunks.push(chunk);
        this.receivedSize += chunk.byteLength;
        
        this.onProgress({
          fileName: this.expectedFileName,
          fileSize: this.expectedFileSize,
          transferred: this.receivedSize,
          status: 'transferring'
        });

        if (this.receivedSize >= this.expectedFileSize) {
          const fileBlob = new Blob(this.receivedChunks);
          this.onFileReceived(fileBlob, this.expectedFileName);
          this.onProgress({
            fileName: this.expectedFileName,
            fileSize: this.expectedFileSize,
            transferred: this.receivedSize,
            status: 'completed'
          });
        }
      }
    };
  }

  async sendFile(file: File) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    // Send metadata first
    this.dataChannel.send(JSON.stringify({
      type: 'metadata',
      name: file.name,
      size: file.size
    }));

    const reader = file.stream().getReader();
    let offset = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // WebRTC has a buffer limit, we need to wait if it's full
      while (this.dataChannel.bufferedAmount > this.dataChannel.bufferedAmountLowThreshold) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      this.dataChannel.send(value);
      offset += value.byteLength;
      
      this.onProgress({
        fileName: file.name,
        fileSize: file.size,
        transferred: offset,
        status: 'transferring'
      });
    }

    this.onProgress({
      fileName: file.name,
      fileSize: file.size,
      transferred: file.size,
      status: 'completed'
    });
  }
}
