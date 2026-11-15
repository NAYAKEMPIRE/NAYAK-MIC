// NAYAK MIC - WebRTC Audio System

const SIGNALING_SERVER = "ws://192.168.1.8:3000";

let socket = null;
let peerConnection = null;
let microphone = null;
let audioContext = null;
let analyser = null;
let animationFrame = null;
let pendingCandidates = [];

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const connectBtn = document.getElementById("connectBtn");

const status = document.getElementById("status");
const micStatus = document.getElementById("micStatus");
const receiverStatus = document.getElementById("receiverStatus");

const meterBar = document.getElementById("meterBar");
const pairCode = document.getElementById("pairCode");
const codeBox = document.getElementById("codeBox");
const generatedCode = document.getElementById("generatedCode");
const remoteAudio = document.getElementById("remoteAudio");

let role = null;
let joined = false;

const rtcConfig = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

// Generate 6-digit pairing code
function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// Connect to signaling server
function connectServer(room, deviceRole) {

    return new Promise((resolve, reject) => {

        socket = new WebSocket(SIGNALING_SERVER);

        socket.onopen = () => {
            socket.send(JSON.stringify({
                type: "join",
                room: room,
                role: deviceRole
            }));
        };

        socket.onmessage = async (event) => {

            const message = JSON.parse(event.data);

            if (message.type === "joined") {
                joined = true;
                resolve();
            }

            else if (message.type === "error") {
                reject(new Error(message.message));
            }

            else if (message.type === "peer-joined") {
                await createPeerConnection();
            }

            else if (message.type === "offer") {
                await receiveOffer(message);
            }

            else if (message.type === "answer") {
                await receiveAnswer(message);
            }

            else if (message.type === "ice-candidate") {
                await receiveCandidate(message);
            }

            else if (message.type === "peer-left") {
                receiverStatus.textContent = "Phone disconnected.";
                micStatus.textContent = "Other device disconnected.";
            }
        };

        socket.onerror = () => {
            reject(new Error("Could not connect to NAYAK MIC server."));
        };

        socket.onclose = () => {
            joined = false;
        };
    });
}

// Create WebRTC connection
async function createPeerConnection() {

    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {

        if (event.candidate) {
            sendSignal({
                type: "ice-candidate",
                candidate: event.candidate
            });
        }
    };

    peerConnection.ontrack = (event) => {

        remoteAudio.srcObject = event.streams[0];

        remoteAudio.play().catch(() => {
            receiverStatus.textContent =
                "Press Play to hear the microphone.";
        });

        receiverStatus.textContent = "Live audio connected!";
        status.textContent = "● Connected";
        status.style.color = "#00ff88";
    };

    peerConnection.onconnectionstatechange = () => {

        if (peerConnection.connectionState === "failed") {
            receiverStatus.textContent = "Connection failed.";
        }
    };

    if (role === "receiver") {

        peerConnection.addTransceiver("audio", {
            direction: "recvonly"
        });

        const offer = await peerConnection.createOffer();

        await peerConnection.setLocalDescription(offer);

        sendSignal({
            type: "offer",
            sdp: peerConnection.localDescription
        });
    }

    if (role === "mic" && microphone) {

        microphone.getTracks().forEach(track => {
            peerConnection.addTrack(track, microphone);
        });
    }
}

// Send signaling message
function sendSignal(message) {

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

// Receive offer on mobile
async function receiveOffer(message) {

    if (!peerConnection) {
        await createPeerConnection();
    }

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(message.sdp)
    );

    for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(candidate);
    }

    pendingCandidates = [];

    const answer = await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(answer);

    sendSignal({
        type: "answer",
        sdp: peerConnection.localDescription
    });
}

// Receive answer on computer
async function receiveAnswer(message) {

    if (!peerConnection) return;

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(message.sdp)
    );

    for (const candidate of pendingCandidates) {
        await peerConnection.addIceCandidate(candidate);
    }

    pendingCandidates = [];
}

// Receive ICE candidate
async function receiveCandidate(message) {

    if (!peerConnection) return;

    const candidate = new RTCIceCandidate(message.candidate);

    if (peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(candidate);
    } else {
        pendingCandidates.push(candidate);
    }
}

// Audio meter
function showAudioLevel() {

    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);

    function update() {

        analyser.getByteFrequencyData(data);

        const average =
            data.reduce((a, b) => a + b, 0) / data.length;

        meterBar.style.width =
            Math.min(100, average * 2) + "%";

        animationFrame = requestAnimationFrame(update);
    }

    update();
}

// Start mobile microphone
startBtn.addEventListener("click", async () => {

    try {

        role = "mic";

        micStatus.textContent = "Requesting microphone permission...";

        microphone = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        const room = generateCode();

        await connectServer(room, "mic");

        codeBox.hidden = false;
        generatedCode.textContent = room;

        audioContext = new AudioContext();

        const source = audioContext.createMediaStreamSource(microphone);

        analyser = audioContext.createAnalyser();
        source.connect(analyser);

        analyser.fftSize = 256;

        showAudioLevel();

        startBtn.disabled = true;
        stopBtn.disabled = false;

        micStatus.textContent = "Microphone active. Waiting for computer...";

        status.textContent = "● Waiting";
        status.style.color = "#00aaff";

    } catch (error) {

        micStatus.textContent = error.message;

        console.error(error);

        stopMicrophone();
    }
});

// Connect computer receiver
connectBtn.addEventListener("click", async () => {

    const room = pairCode.value.trim();

    if (!/^\d{6}$/.test(room)) {
        receiverStatus.textContent = "Enter a valid 6-digit code.";
        return;
    }

    try {

        role = "receiver";

        connectBtn.disabled = true;

        receiverStatus.textContent = "Connecting...";

        await connectServer(room, "receiver");

        receiverStatus.textContent = "Waiting for phone...";

        status.textContent = "● Waiting";
        status.style.color = "#00aaff";

    } catch (error) {

        receiverStatus.textContent = error.message;

        connectBtn.disabled = false;

        console.error(error);
    }
});

// Stop microphone
function stopMicrophone() {

    if (microphone) {
        microphone.getTracks().forEach(track => track.stop());
        microphone = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    if (socket) {
        socket.close();
        socket = null;
    }

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    analyser = null;
    pendingCandidates = [];
    joined = false;

    meterBar.style.width = "0%";

    codeBox.hidden = true;

    startBtn.disabled = false;
    stopBtn.disabled = true;

    micStatus.textContent = "Microphone: Stopped";

    status.textContent = "● Offline";
    status.style.color = "#ff5555";
}

stopBtn.addEventListener("click", stopMicrophone);