import { useState, useEffect, useRef } from "react";
import useWebSocket from "react-use-websocket";
import EmojiPicker from 'emoji-picker-react';
import axios from 'axios';
import "./App.css";

function App() {
  // --- STATES ---
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileInputRef = useRef(null);

  // --- WEBRTC REFS ---
  const [localStream, setLocalStream] = useState(null);
  const pc = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [callType, setCallType] = useState(null);

  const BACKEND_URL = "http://127.0.0.1:8000";
  const WS_URL = "ws://127.0.0.1:8000/ws/chat/";

  const { sendJsonMessage, lastJsonMessage } = useWebSocket(token ? WS_URL : null, {
    shouldReconnect: () => true,
  });

  // --- 1. LOAD HISTORY WHEN TOKEN EXISTS ---
  useEffect(() => {
    if (token) {
      axios.get(`${BACKEND_URL}/api/messages/`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => setChatHistory(res.data)).catch(err => console.error(err));
    }
  }, [token]);

  // --- 2. RESTORE TOKEN ON REFRESH ---
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  // --- 3. HANDLE INCOMING MESSAGES (PREVENT DUPLICATES) ---
  useEffect(() => {
    if (lastJsonMessage) {
      const { msg_type, offer, answer, candidate, username: sender, call_mode } = lastJsonMessage;

      if (msg_type === 'rtc_offer' && sender !== username) {
        if (window.confirm(`${sender} is ${call_mode} calling. Accept?`)) {
          startLocalStream(call_mode === 'video').then(async (success) => {
            if (success && pc.current) {
              setCallType(call_mode);
              await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
              const ans = await pc.current.createAnswer();
              await pc.current.setLocalDescription(ans);
              sendJsonMessage({ msg_type: 'rtc_answer', answer: ans, username });
            }
          });
        }
      } else if (msg_type === 'rtc_answer' && sender !== username) {
        if (pc.current) pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      } else if (msg_type === 'rtc_candidate' && sender !== username) {
        if (pc.current) pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else if (!msg_type.startsWith('rtc_')) {
        // FIX: Only add message to history if the sender is NOT me (prevents duplicates)
        if (sender !== username) {
          setChatHistory(prev => [...prev, lastJsonMessage]);
        }
      }
    }
  }, [lastJsonMessage]);

  // --- CALLING LOGIC ---
  const startLocalStream = async (isVideo) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      pc.current = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      stream.getTracks().forEach(track => pc.current.addTrack(track, stream));
      pc.current.onicecandidate = (e) => e.candidate && sendJsonMessage({ msg_type: 'rtc_candidate', candidate: e.candidate, username });
      pc.current.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
      return true;
    } catch (err) {
      alert("Hardware Error: Camera/Mic not found.");
      return false;
    }
  };

  const handleCall = async (mode) => {
    const success = await startLocalStream(mode === 'video');
    if (success && pc.current) {
      setCallType(mode);
      const offer = await pc.current.createOffer();
      await pc.current.setLocalDescription(offer);
      sendJsonMessage({ msg_type: 'rtc_offer', offer, username, call_mode: mode });
    }
  };

  // --- 4. SEND MESSAGE WITH OPTIMISTIC UI ---
  const handleSendMessage = () => {
    if (message.trim()) {
      // Create message object
      const msgObj = {
        message,
        username,
        msg_type: 'text',
        timestamp: new Date().toLocaleTimeString()
      };

      // Add to screen IMMEDIATELY
      setChatHistory(prev => [...prev, msgObj]);

      // Clear inputs
      setMessage("");
      setShowEmoji(false);

      // Send to server for others
      sendJsonMessage(msgObj);
    }
  };

  // --- 5. HANDLE FILE UPLOAD WITH INSTANT PREVIEW ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    // Create a temporary preview URL
    const localUrl = URL.createObjectURL(file);
    const type = file.type.split('/')[0];

    const msgObj = {
      username,
      msg_type: type === 'image' || type === 'video' ? type : 'file',
      media_url: localUrl, // Use local URL for instant view
      message: `Sent a ${type}`,
      timestamp: new Date().toLocaleTimeString()
    };

    // Add to screen IMMEDIATELY
    setChatHistory(prev => [...prev, msgObj]);

    // Upload to server in background
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await axios.post(`${BACKEND_URL}/api/upload/`, formData, { headers: { 'Authorization': `Bearer ${token}` } });
      
      // Send the REAL server URL to others via WebSocket
      sendJsonMessage({ 
        username, 
        msg_type: type === 'image' || type === 'video' ? type : 'file', 
        media_url: res.data.file, 
        message: `Sent a ${type}` 
      });
    } catch (err) { 
      alert("Upload failed"); 
    }
  };

  // --- AUTHENTICATION ---
  const handleAuth = async (da) => {
    da.preventDefault();
    const path = isRegistering ? "/api/register/" : "/api/token/";
    try {
      const res = await fetch(`${BACKEND_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (res.ok) {
        if (isRegistering) {
          setIsRegistering(false);
        } else {
          setToken(data.access);
          localStorage.setItem("token", data.access); // SAVE TOKEN
        }
      } else {
        alert(data.error || "Failed");
      }
    } catch (err) { alert("Server Down"); }
  };

  // --- RENDER LOGIC ---
  const renderMessage = (msg) => {
    // FIX: Handle blob URLs (local previews) and server URLs
    const fullUrl = msg.media_url?.startsWith('blob:') || msg.media_url?.startsWith('http')
      ? msg.media_url
      : `${BACKEND_URL}${msg.media_url}`;

    if (msg.msg_type === 'image') return <img src={fullUrl} className="chat-media" alt="Sent media" />;
    if (msg.msg_type === 'video') return <video src={fullUrl} controls className="chat-media" />;
    if (msg.msg_type === 'audio') return <audio src={fullUrl} controls className="chat-media" />;
    if (msg.msg_type === 'file') return <a href={fullUrl} target="_blank" rel="noreferrer" className="chat-media download-link">Download File</a>;
    return msg.message;
  };

  if (token) {
    return (
      <div className="chat-container">
        {/* HEADER */}
        <div className="chat-header">
          <h2 className="chat-header-title">Global Chat</h2>
          <div className="call-actions">
            <span onClick={() => handleCall('audio')}>📞</span>
            <span onClick={() => handleCall('video')}>🎥</span>
          </div>
        </div>

        {/* VIDEO OVERLAY */}
        {localStream && (
          <div className="video-overlay">
            <div className="video-row">
              {callType === 'video' && <video ref={localVideoRef} autoPlay muted className="local-video" />}
              <video ref={remoteVideoRef} autoPlay className="remote-video" />
            </div>
            <button onClick={() => window.location.reload()} className="end-call-btn">End Call</button>
          </div>
        )}

        {/* CHAT BOX */}
        <div className="chat-box">
          {chatHistory.map((msg, i) => (
            <div key={i} className={`message ${msg.username === username ? 'my-msg' : ''}`}>
              <strong>{msg.username}:</strong> {renderMessage(msg)}
              <div className="chat-time">{msg.timestamp}</div>
            </div>
          ))}
        </div>
        
        {/* EMOJI PICKER */}
        {showEmoji && (
          <div className="emoji-picker-container">
            <EmojiPicker onEmojiClick={(e) => setMessage(prev => prev + e.emoji)} />
          </div>
        )}

        {/* TOOLBAR */}
        <div className="chat-toolbar">
          <button onClick={() => setShowEmoji(!showEmoji)}>😊</button>
          <button onClick={() => fileInputRef.current.click()}>📁</button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} hidden />
        </div>

        {/* INPUT ROW */}
        <div className="input-row">
          <input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendMessage()} placeholder="Type..." />
          <button onClick={handleSendMessage}>Send</button>
        </div>
        
        {/* LOGOUT */}
        <button onClick={() => { 
            setToken(""); 
            localStorage.removeItem("token"); // CLEAR TOKEN
        }} className="logout-btn">Logout</button>
      </div>
    );
  }

  // LOGIN / REGISTER PAGE
  return (
    <div className="login-card">
      <h1>{isRegistering ? "Register" : "Login"}</h1>
      <form onSubmit={handleAuth}>
        <input placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit" className="login-btn">{isRegistering ? "Register" : "Login"}</button>
      </form>
      <p onClick={() => setIsRegistering(!isRegistering)} className="toggle-auth">
        {isRegistering ? "Back to Login" : "Register here"}
      </p>
    </div>
  );
}

export default App;




