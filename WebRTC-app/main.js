import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDbUsR5hk0FJQ5pSpbY_m9e871VT_8aFUI",
  authDomain: "webrtc-a4103.firebaseapp.com",
  projectId: "webrtc-a4103",
  storageBucket: "webrtc-a4103.appspot.com",
  messagingSenderId: "1073178977423",
  appId: "1:1073178977423:web:67627e66d4bcc68092fcfa",
  measurementId: "G-H62Q292ZBF"
};

// initialize firebase app
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// 1. Setup media sources

webcamButton.onclick = async () => {
  // get local video stream from user's video cam
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  // initiate remote stream 
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  
  /* 
  Ontrack - is an event handler which specifies a function to be called 
  when the track event occurs, indicating that a track has been 
  added to the RTCPeerConnection
  */
  pc.ontrack = (event) => {
    // Pull tracks from remote stream, add to video stream
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  // let's apply video elements to DOM
  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  // callDoc will be used to manage answer and offer for both clients
  const callDoc = firestore.collection('calls').doc();
  // these two will be collection under callDoc
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  // firebase will generate automatically random id
  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  //an ice candidate contains potential IP address and port that can be used to establish actual p2p connection
  //setup listener before setLocalDescription to capture the event
  pc.onicecandidate = (event) => {
    //when the event is fired we make sure a candidate exists and write json to offerCandidates collection
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer(); // contains sdp value, which we want to save to db
  // when we called setLocalDescription, ice candidates are created automatically
  await pc.setLocalDescription(offerDescription); 

  // convert to plan JS object
  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  // write to db
  await callDoc.set({ offer });

  // Listen for remote answer from the other end(user)
  /* 
  -- onSnapshot --
  You can listen to a document with the onSnapshot() method. An initial call using the callback you provide 
  creates a document snapshot immediately with the current contents of the single document. 
  Then, each time the contents change, another call updates the document snapshot.
  */
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    /* 
    -- docChanges() --
    LISTEN TO DOCUMENTS THAT HAVE BEEN ADDED TO THE COLLECTION
    */
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        // create ice candidate with that document data and add to peer connection
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  /* 
  -- onicecandidate --
  The RTCPeerConnection property onicecandidate property is an event handler 
  which specifies a function to be called when the icecandidate event occurs 
  on an RTCPeerConnection instance. This happens whenever the local ICE agent 
  needs to deliver a message to the other peer through the signaling server. 
  This lets the ICE agent perform negotiation with the remote peer without the 
  browser itself needing to know any specifics about the technology being used for signaling; 
  implement this method to use whatever messaging technology you choose to send the ICE candidate to the remote peer.
  */
  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };
  // grab the document
  const callData = (await callDoc.get()).data();

  //grab the offerDescription
  const offerDescription = callData.offer;
  // set Remote description
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));
  // create answer and setLocalDescription
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  //update with current answer the document
  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};