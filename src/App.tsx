import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  Download, 
  Share2, 
  File, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Copy,
  ArrowLeft,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { P2PTransfer, TransferProgress } from './lib/p2p';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [mode, setMode] = useState<'home' | 'send' | 'receive'>('home');
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<TransferProgress>({
    fileName: '',
    fileSize: 0,
    transferred: 0,
    status: 'idle'
  });
  const [error, setError] = useState<string | null>(null);
  const p2pRef = useRef<P2PTransfer | null>(null);

  const selectedFileRef = useRef<File | null>(null);
  const modeRef = useRef<'home' | 'send' | 'receive'>('home');

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    p2pRef.current = new P2PTransfer(
      (p) => setProgress(p),
      (blob, name) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      },
      () => {
        if (selectedFileRef.current && modeRef.current === 'send') {
          p2pRef.current?.sendFile(selectedFileRef.current);
        }
      }
    );
  }, []);

  const handleSend = async (file?: File) => {
    const fileToUse = file || selectedFile;
    if (!fileToUse) return;
    try {
      setError(null);
      const id = await p2pRef.current?.createRoom();
      if (id) {
        setRoomId(id);
        setMode('send');
      }
    } catch (err) {
      setError('Failed to create room. Please try again.');
      console.error(err);
    }
  };

  const handleReceive = async () => {
    if (!inputRoomId) return;
    try {
      setError(null);
      await p2pRef.current?.joinRoom(inputRoomId);
      setMode('receive');
    } catch (err) {
      setError('Invalid room code or connection failed.');
      console.error(err);
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const percent = progress.fileSize > 0 
    ? Math.round((progress.transferred / progress.fileSize) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setMode('home')}
          >
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform">
              <Zap size={18} fill="currentColor" />
            </div>
            <span className="font-bold text-xl tracking-tight">DropShare</span>
          </div>
          <div className="flex items-center gap-6 text-sm font-medium text-neutral-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={16} className="text-green-500" />
              <span>P2P Encrypted</span>
            </div>
            <div className="hidden sm:block">No File Limits</div>
          </div>
        </div>
      </header>

      <main className="pt-32 pb-16 px-4">
        <div className="max-w-2xl mx-auto">
          <AnimatePresence mode="wait">
            {mode === 'home' && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-12 text-center"
              >
                <div className="space-y-4">
                  <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-neutral-950">
                    Share files <span className="text-blue-600">instantly</span>
                  </h1>
                  <p className="text-lg text-neutral-600 max-w-lg mx-auto">
                    Direct peer-to-peer transfer. No servers, no storage, no limits. 
                    Send up to 5GB+ directly from your browser.
                  </p>
                </div>

                <div className="grid sm:grid-cols-2 gap-6">
                  {/* Send Card */}
                  <div className="bg-white p-8 rounded-3xl border border-neutral-200 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all group">
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Upload size={32} />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Send Files</h3>
                    <p className="text-neutral-500 text-sm mb-6">
                      Select a file and get a unique code to share with anyone.
                    </p>
                    <label className="block">
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            setSelectedFile(file);
                            selectedFileRef.current = file;
                            handleSend(file);
                          }
                        }}
                      />
                      <div className="w-full py-3 px-6 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors cursor-pointer text-center">
                        Select File
                      </div>
                    </label>
                  </div>

                  {/* Receive Card */}
                  <div className="bg-white p-8 rounded-3xl border border-neutral-200 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all group">
                    <div className="w-16 h-16 bg-neutral-50 text-neutral-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                      <Download size={32} />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Receive Files</h3>
                    <p className="text-neutral-500 text-sm mb-6">
                      Enter the code shared with you to start the direct download.
                    </p>
                    <div className="space-y-3">
                      <input 
                        type="text"
                        placeholder="Enter 6-digit code"
                        value={inputRoomId}
                        onChange={(e) => setInputRoomId(e.target.value)}
                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      />
                      <button 
                        onClick={handleReceive}
                        disabled={!inputRoomId}
                        className="w-full py-3 px-6 bg-neutral-900 text-white rounded-xl font-semibold hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        Join Room
                      </button>
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center justify-center gap-2 text-red-600 bg-red-50 py-3 px-4 rounded-xl border border-red-100">
                    <AlertCircle size={18} />
                    <span className="text-sm font-medium">{error}</span>
                  </div>
                )}
              </motion.div>
            )}

            {(mode === 'send' || mode === 'receive') && (
              <motion.div
                key="transfer"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white p-8 rounded-3xl border border-neutral-200 shadow-xl space-y-8"
              >
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setMode('home')}
                    className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest">
                    {mode === 'send' ? 'Sending' : 'Receiving'}
                  </div>
                  <div className="w-10" /> {/* Spacer */}
                </div>

                {mode === 'send' && progress.status === 'idle' && (
                  <div className="text-center space-y-6">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold">Share this code</h2>
                      <p className="text-neutral-500">The receiver needs this code to connect to you.</p>
                    </div>
                    
                    <div className="flex items-center justify-center gap-3">
                      <div className="bg-neutral-100 px-8 py-4 rounded-2xl text-3xl font-mono font-bold tracking-wider text-blue-600">
                        {roomId.slice(0, 6).toUpperCase()}
                      </div>
                      <button 
                        onClick={copyRoomId}
                        className="p-4 bg-neutral-100 hover:bg-neutral-200 rounded-2xl transition-colors text-neutral-600"
                        title="Copy Code"
                      >
                        <Copy size={24} />
                      </button>
                    </div>

                    <div className="flex items-center justify-center gap-4 py-4">
                      <div className="flex items-center gap-2 text-neutral-500 text-sm">
                        <Loader2 size={16} className="animate-spin" />
                        <span>Waiting for receiver...</span>
                      </div>
                    </div>

                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 flex items-start gap-3 text-left">
                      <File className="text-blue-600 shrink-0 mt-0.5" size={20} />
                      <div>
                        <div className="font-bold text-blue-900 text-sm truncate max-w-[240px]">
                          {selectedFile?.name}
                        </div>
                        <div className="text-blue-700 text-xs">
                          {selectedFile && formatSize(selectedFile.size)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {progress.status === 'transferring' && (
                  <div className="space-y-8">
                    <div className="text-center space-y-2">
                      <h2 className="text-2xl font-bold truncate px-4">
                        {progress.fileName || selectedFile?.name}
                      </h2>
                      <p className="text-neutral-500">
                        {formatSize(progress.transferred)} of {formatSize(progress.fileSize || selectedFile?.size || 0)}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="h-4 bg-neutral-100 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-blue-600"
                          initial={{ width: 0 }}
                          animate={{ width: `${percent}%` }}
                          transition={{ type: 'spring', bounce: 0, duration: 0.5 }}
                        />
                      </div>
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-blue-600">{percent}%</span>
                        <span className="text-neutral-400">Direct P2P Link</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-center gap-2 text-neutral-500 text-sm bg-neutral-50 py-3 rounded-xl">
                      <Zap size={14} className="text-yellow-500 fill-yellow-500" />
                      <span>Optimizing transfer speed...</span>
                    </div>
                  </div>
                )}

                {progress.status === 'completed' && (
                  <div className="text-center space-y-6 py-4">
                    <div className="flex justify-center">
                      <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                        <CheckCircle2 size={48} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-bold">Transfer Complete!</h2>
                      <p className="text-neutral-500">
                        The file was successfully {mode === 'send' ? 'sent' : 'received'}.
                      </p>
                    </div>
                    <button 
                      onClick={() => {
                        setMode('home');
                        setProgress({ fileName: '', fileSize: 0, transferred: 0, status: 'idle' });
                      }}
                      className="w-full py-3 px-6 bg-neutral-900 text-white rounded-xl font-semibold hover:bg-neutral-800 transition-all"
                    >
                      Done
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 py-6 text-center text-neutral-400 text-xs">
        <p>© 2026 DropShare • Direct Peer-to-Peer File Transfer</p>
      </footer>
    </div>
  );
}
