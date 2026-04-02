import { 
  collection, 
  doc, 
  addDoc, 
  onSnapshot, 
  updateDoc, 
  serverTimestamp,
  query,
  where
} from 'firebase/firestore';
import { db } from './firebase';

const CHUNK_SIZE = 16384; // 16KB chunks for maximum compatibility
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1MB buffer limit

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
  private iceCandidateQueue: RTCIceCandidate[] = [];

  constructor(
    onProgress: (progress: TransferProgress) => void,
    onFileReceived: (file: Blob, name: string) => void,
    onConnected?: () => void
  ) {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
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
        }).catch(err => console.error('Error adding ICE candidate:', err));
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'connected') {
        this.onConnected?.();
      } else if (this.peerConnection.connectionState === 'failed' || this.peerConnection.connectionState === 'closed') {
        this.onProgress({
          fileName: '',
          fileSize: 0,
          transferred: 0,
          status: 'error',
          error: 'Connection lost'
        });
      }
    };
  }

  private async processIceQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      if (candidate) {
        try {
          await this.peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
    }
  }

  async createRoom(): Promise<string> {
    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
      ordered: true
    });
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

    onSnapshot(roomDoc, async (snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !this.peerConnection.currentRemoteDescription) {
        const answer = new RTCSessionDescription(JSON.parse(data.answer));
        await this.peerConnection.setRemoteDescription(answer);
        await this.processIceQueue();
      }
    });

    const candidatesRef = collection(db, 'rooms', this.roomId, 'candidates');
    onSnapshot(candidatesRef, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          if (data.type === 'answer') {
            const candidate = new RTCIceCandidate(JSON.parse(data.candidate));
            if (this.peerConnection.remoteDescription) {
              await this.peerConnection.addIceCandidate(candidate).catch(e => console.error(e));
            } else {
              this.iceCandidateQueue.push(candidate);
            }
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
        if (snapshot.empty) return; // Keep waiting for a bit or handle timeout elsewhere

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
        await this.processIceQueue();

        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        await updateDoc(roomRef, {
          answer: JSON.stringify(answer),
          status: 'connected',
        });

        const candidatesRef = collection(db, 'rooms', this.roomId, 'candidates');
        onSnapshot(candidatesRef, (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const data = change.doc.data();
              if (data.type === 'offer') {
                const candidate = new RTCIceCandidate(JSON.parse(data.candidate));
                if (this.peerConnection.remoteDescription) {
                  await this.peerConnection.addIceCandidate(candidate).catch(e => console.error(e));
                } else {
                  this.iceCandidateQueue.push(candidate);
                }
              }
            }
          });
        });

        unsubscribe();
        resolve();
      });
      
      // Timeout after 10 seconds if no room found
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Room not found or timeout'));
      }, 10000);
    });
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    
    channel.onopen = () => {
      console.log('Data channel opened');
      this.onProgress({
        fileName: '',
        fileSize: 0,
        transferred: 0,
        status: 'transferring'
      });
    };
    
    channel.onclose = () => console.log('Data channel closed');
    
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
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
        } catch (e) {
          console.error('Error parsing metadata', e);
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
          this.receivedChunks = []; // Clear memory
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Manual chunking of the stream value if it's too large
        let chunkOffset = 0;
        while (chunkOffset < value.byteLength) {
          const end = Math.min(chunkOffset + CHUNK_SIZE, value.byteLength);
          const chunk = value.slice(chunkOffset, end);

          // WebRTC has a buffer limit, we need to wait if it's full
          while (this.dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            await new Promise(resolve => setTimeout(resolve, 50));
            if (this.dataChannel.readyState !== 'open') throw new Error('Channel closed');
          }

          this.dataChannel.send(chunk);
          chunkOffset = end;
          offset += chunk.byteLength;
          
          this.onProgress({
            fileName: file.name,
            fileSize: file.size,
            transferred: offset,
            status: 'transferring'
          });
        }
      }

      this.onProgress({
        fileName: file.name,
        fileSize: file.size,
        transferred: file.size,
        status: 'completed'
      });
    } catch (err) {
      this.onProgress({
        fileName: file.name,
        fileSize: file.size,
        transferred: offset,
        status: 'error',
        error: err instanceof Error ? err.message : 'Transfer failed'
      });
      throw err;
    }
  }
}
