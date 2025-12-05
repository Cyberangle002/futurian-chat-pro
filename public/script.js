// script.js - client for Futurian Chat (full features)
// NOTE: This is a demo; in production sanitize server-side and use real file upload.

const socket = io();
let my = { name: null, color: '#7c3aed', status: 'Active' };
let currentRoom = null;
let typingSet = new Set();
let replyTo = null;
let dnd = false; // do not disturb flag

// DOM
const loginModal = document.getElementById('loginModal');
const loginName = document.getElementById('loginName');
const loginRoom = document.getElementById('loginRoom');
const loginColor = document.getElementById('loginColor');
const loginBtn = document.getElementById('loginBtn');

const roomsList = document.getElementById('roomsList');
const newRoomName = document.getElementById('newRoomName');
const createRoomBtn = document.getElementById('createRoomBtn');
const usersList = document.getElementById('usersList');

const currentRoomEl = document.getElementById('currentRoom');
const roomDesc = document.getElementById('roomDesc');
const messagesEl = document.getElementById('messages');
const typingIndicator = document.getElementById('typingIndicator');
const msgForm = document.getElementById('msgForm');
const msgInput = document.getElementById('msgInput');
const fileInput = document.getElementById('fileInput');
const emojiPicker = document.getElementById('emojiPicker');
const sendBtn = document.getElementById('sendBtn');

const profileModal = document.getElementById('profileModal');
const openProfile = document.getElementById('openProfile');
const profileName = document.getElementById('profileName');
const profileColor = document.getElementById('profileColor');
const profileStatus = document.getElementById('profileStatus');
const saveProfile = document.getElementById('saveProfile');
const closeProfile = document.getElementById('closeProfile');

const globalSearch = document.getElementById('globalSearch');
const themeSelect = document.getElementById('themeSelect');
const notifToggle = document.getElementById('notifToggle');
const dndToggle = document.getElementById('dndToggle');

const replyBox = document.getElementById('replyBox');
const replyToUser = document.getElementById('replyToUser');
const replyText = document.getElementById('replyText');
const cancelReply = document.getElementById('cancelReply');

// Helpers
function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }
function fmt(t){ return new Date(t).toLocaleTimeString(); }
function genId(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6); }
function notify(title, body){
  if(dnd) return;
  if(Notification.permission === 'granted'){
    new Notification(title, { body });
  } else {
    // try request once
    Notification.requestPermission().then(()=>{ if(Notification.permission==='granted') new Notification(title,{body});});
  }
}
function playSound(){
  if(dnd) return;
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type='sine'; o.frequency.value=880; g.gain.value=0.01;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime+0.06);
  }catch(e){}
}

// request initial rooms
socket.emit('request_rooms');

// list rooms
socket.on('rooms_list', list=>{
  roomsList.innerHTML='';
  list.forEach(r=>{
    const card = el(`<div class="roomCard" data-room="${r.name}"><div><strong>${r.name}</strong><div class="muted">${r.description}</div></div><div class="muted">${r.members}</div></div>`);
    card.onclick = ()=> {
      if(!my.name) return alert('Join first');
      joinRoom(my.name, r.name);
    };
    roomsList.appendChild(card);
  });
  // also update loginRoom options
  if(loginRoom){
    loginRoom.innerHTML='';
    list.forEach(r=>{ const o=document.createElement('option'); o.value=r.name; o.textContent=r.name; loginRoom.appendChild(o); });
  }
});

// create room
createRoomBtn.onclick = ()=>{
  const name = newRoomName.value.trim(); if(!name) return alert('Name required');
  socket.emit('create_room', { room: name }, res=>{ if(res && res.error) alert(res.error); else newRoomName.value=''; socket.emit('request_rooms'); });
};

// join flow
loginBtn.onclick = ()=>{
  const name = loginName.value.trim(); const room = loginRoom.value || 'General';
  if(!name) return alert('Enter name');
  my.name = name; my.color = loginColor.value || my.color;
  socket.emit('joinRoom', { username: my.name, room, color: my.color, status: 'Active' }, res=>{
    if(res && res.error) return alert(res.error);
    loginModal.classList.add('hidden');
    currentRoom = room;
  });
};

// handle init room
socket.on('init_room', ({ room, users, messages: msgs, roomMeta })=>{
  currentRoom = room;
  currentRoomEl.textContent = room;
  roomDesc.textContent = roomMeta && roomMeta.description ? roomMeta.description : 'Chat room';
  usersList.innerHTML = users.map(u=>`<div class="user"><span class="user-dot"></span>${u}</div>`).join('');
  messagesEl.innerHTML = '';
  msgs.forEach(m => addMsgNode(m));
});

// room users
socket.on('roomUsers', users=>{
  usersList.innerHTML = users.map(u=>`<div class="user"><span class="user-dot"></span>${u}</div>`).join('');
});

// system messages
socket.on('system_message', ({ text, time })=>{ addSystem(text, time); playSound(); });

// new message
socket.on('newMessage', msg=>{
  addMsgNode(msg);
  if(msg.user !== my.name){
    notify(`${msg.user} in ${currentRoom}`, msg.text ? (msg.text.slice(0,80)) : (msg.file ? msg.file.filename : 'file'));
    playSound();
  }
});

// typing
socket.on('typing', ({ user })=>{ typingSet.add(user); renderTyping(); });
socket.on('stopTyping', ({ user })=>{ typingSet.delete(user); renderTyping(); });

socket.on('updateReactions', ({ msgId, reactions })=>{
  const node = document.querySelector(`[data-id="${msgId}"]`);
  if(!node) return;
  const box = node.querySelector('.reactions');
  box.innerHTML = renderReactions(reactions);
});

socket.on('updateMessage', msg=>{
  const node = document.querySelector(`[data-id="${msg.id}"]`);
  if(node) node.querySelector('.text').innerHTML = (msg.text || '');
});

socket.on('deleteMessage', ({ msgId })=>{
  const node = document.querySelector(`[data-id="${msgId}"]`);
  if(node) node.remove();
});

socket.on('threadCreated', ({ threadId, parentMsgId })=>{
  // simple visual indicator (could open sidebar thread)
  console.log('Thread created', threadId, parentMsgId);
});

socket.on('threadMessage', ({ threadId, msg })=>{
  // we don't show threads in this simple demo UI; could be extended.
  console.log('thread msg', threadId, msg);
});

// UI helpers
function addSystem(text, time){
  const node = el(`<div class="msg"><div class="meta"><em>System</em><span>${fmt(time)}</span></div><div class="text muted">${text}</div></div>`);
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMsgNode(m){
  const isMe = (m.user === my.name);
  const wrapper = document.createElement('div');
  wrapper.className = 'msg' + (isMe ? ' me':'');
  wrapper.setAttribute('data-id', m.id);
  wrapper.innerHTML = `
    <div class="meta"><strong>${escapeHtml(m.user)}</strong><span>${fmt(m.time)}${m.edited? ' • edited':''}</span></div>
    <div class="text">${m.text || ''}</div>
    <div class="controls">
      <div class="reactions">${renderReactions(m.reactions || {})}</div>
      <div>
        <button class="smallBtn react" data-emoji="❤️">❤️</button>
        <button class="smallBtn react" data-emoji="😂">😂</button>
        <button class="smallBtn replyBtn">Reply</button>
        ${isMe? '<button class="smallBtn editBtn">Edit</button><button class="smallBtn delBtn">Delete</button>':''}
      </div>
    </div>
  `;
  // file preview
  if(m.file){
    const f = document.createElement('div');
    f.className = 'filePreview';
    if(m.file.mimetype && m.file.mimetype.startsWith('image/')){
      f.innerHTML = `<img src="${m.file.url}" style="max-width:240px;border-radius:8px;display:block;margin-top:8px">`;
    } else {
      f.innerHTML = `<a href="${m.file.url}" download="${m.file.filename}">📎 ${m.file.filename}</a>`;
    }
    wrapper.appendChild(f);
  }
  // reply reference
  if(m.replyTo){
    const ref = el(`<div class="replyRef muted">Reply to: <em>${escapeHtml(m.replyTo.user || m.replyTo)}</em> - ${escapeHtml((m.replyTo.text||'').slice(0,80))}</div>`);
    wrapper.insertBefore(ref, wrapper.querySelector('.text'));
  }

  // attach handlers
  wrapper.querySelectorAll('.react').forEach(b=>{
    b.onclick = ()=> socket.emit('reactMessage', { msgId: m.id, emoji: b.dataset.emoji });
  });
  wrapper.querySelectorAll('.replyBtn').forEach(b=>{
    b.onclick = ()=> startReply(m);
  });
  const editBtn = wrapper.querySelector('.editBtn');
  if(editBtn){
    editBtn.onclick = ()=> editMessageFlow(m);
  }
  const delBtn = wrapper.querySelector('.delBtn');
  if(delBtn){
    delBtn.onclick = ()=> { if(confirm('Delete message?')) socket.emit('deleteMessage', m.id); };
  }
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderReactions(reactions){
  return Object.keys(reactions||{}).map(k=>`<span class="reaction-pill">${k} ${reactions[k].length}</span>`).join(' ');
}

function renderTyping(){
  if(typingSet.size === 0){ typingIndicator.textContent=''; return; }
  const arr = Array.from(typingSet).slice(0,3);
  typingIndicator.textContent = (arr.join(', ') + (typingSet.size>1 ? ' are typing...' : ' is typing...'));
}

// message send
msgForm.addEventListener('submit', e=>{
  e.preventDefault();
  const text = msgInput.value.trim();
  if(!text && !fileInput.files[0]) return;
  // send file if present
  if(fileInput.files[0]){
    const f = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = ()=> {
      const b64 = reader.result.split(',')[1];
      socket.emit('uploadFile', { filename: f.name, mimetype: f.type, b64data: b64 }, res => {
        // optional callback
      });
    };
    reader.readAsDataURL(f);
    fileInput.value = '';
    msgInput.value = '';
    socket.emit('stopTyping');
    return;
  }

  const payload = { text: msgInput.value, replyTo: replyTo ? { user: replyTo.user, text: replyTo.text, id: replyTo.id } : null };
  socket.emit('chatMessage', payload, res=>{
    if(res && res.error) return alert(res.error);
    msgInput.value = '';
    replyTo = null; replyBox.classList.add('hidden');
    socket.emit('stopTyping');
  });
});

// typing
let typingTimer = null;
msgInput.addEventListener('input', ()=>{
  socket.emit('typing');
  clearTimeout(typingTimer);
  typingTimer = setTimeout(()=> socket.emit('stopTyping'), 900);
});

// reply flow
function startReply(m){
  replyTo = m;
  replyBox.classList.remove('hidden');
  replyToUser.textContent = m.user;
  replyText.textContent = (m.text || (m.file ? m.file.filename : ''));
}
cancelReply.onclick = ()=> { replyTo = null; replyBox.classList.add('hidden'); };

// edit flow
function editMessageFlow(m){
  const newText = prompt('Edit your message', m.text || '');
  if(newText === null) return;
  socket.emit('editMessage', { msgId: m.id, newText }, res=>{ if(res && res.error) alert(res.error); });
}

// emoji picker simple
emojiPicker.onclick = ()=> {
  const pick = prompt('Enter emoji or choose 1..7:\\n1:😀 2:😂 3:👍 4:❤️ 5:😮 6:🔥 7:🎉');
  if(!pick) return;
  let val = pick;
  const idx = parseInt(pick);
  if(!isNaN(idx) && idx>=1 && idx<=7){
    const arr=['😀','😂','👍','❤️','😮','🔥','🎉'];
    val = arr[idx-1];
  }
  msgInput.value += ' '+val;
  msgInput.focus();
};

// file input handled on submit above

// profile modal
openProfile.onclick = ()=> { profileModal.classList.remove('hidden'); profileName.value = my.name || ''; profileColor.value = my.color || '#7c3aed'; profileStatus.value = my.status || 'Active'; };
closeProfile.onclick = ()=> profileModal.classList.add('hidden');
saveProfile.onclick = ()=> {
  my.name = profileName.value || my.name;
  my.color = profileColor.value || my.color;
  my.status = profileStatus.value || my.status;
  profileModal.classList.add('hidden');
  // update on server by rejoin (quick hack) - in production you'd have updateProfile socket
  if(currentRoom) {
    socket.emit('joinRoom', { username: my.name, room: currentRoom, color: my.color, status: my.status }, ()=>{});
  }
};

// search
globalSearch.addEventListener('input', ()=> {
  const q = globalSearch.value.toLowerCase();
  document.querySelectorAll('.msg').forEach(m=>{
    const txt = m.querySelector('.text').textContent.toLowerCase();
    if(!q || txt.includes(q)) m.style.display = '';
    else m.style.display = 'none';
  });
});

// theme switch
themeSelect.onchange = ()=> {
  const v = themeSelect.value;
  if(v==='minimal'){
    document.documentElement.style.setProperty('--neon','#6b7280');
    document.documentElement.style.setProperty('--accent','#9ca3af');
  } else if(v==='dark'){
    document.documentElement.style.setProperty('--neon','#00b4ff');
    document.documentElement.style.setProperty('--accent','#00f0ff');
  } else {
    document.documentElement.style.setProperty('--neon','#7c3aed');
    document.documentElement.style.setProperty('--accent','#00f0ff');
  }
};

// notifications toggle
notifToggle.onclick = ()=> {
  if(Notification && Notification.permission !== 'granted') Notification.requestPermission();
  alert('Desktop notifications will be requested if available.');
};

// DND toggle
dndToggle.onclick = ()=> { dnd = !dnd; dndToggle.style.opacity = dnd? '0.5':'1'; };

// leave
document.getElementById('leaveBtn').onclick = ()=> location.reload();

// simple escape
function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
