// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e7 }); // allow larger payloads (base64 files)

app.use(express.static(path.join(__dirname, 'public')));

// In-memory stores
const users = new Map(); // socketId -> { username, room, color, status }
const rooms = new Map(); // roomName -> { description, isPrivate, owner, members: Set, settings }
const messages = new Map(); // roomName -> [ {id,user,text,time,edited,replyTo,file,reactions,threadId} ]
const threads = new Map(); // threadId -> { parentMsgId, room, messages: [] }

// utilities
function ensureRoom(name){
  if (!rooms.has(name)) {
    rooms.set(name, { description: 'No description', isPrivate: false, owner: null, members: new Set(), settings: {} });
    messages.set(name, []);
  }
}
function genId(){ return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }

// create default room
ensureRoom('General');

io.on('connection', socket => {
  console.log('conn', socket.id);

  // client asks for rooms
  socket.on('request_rooms', () => {
    socket.emit('rooms_list', Array.from(rooms.entries()).map(([name, meta])=>({
      name, description: meta.description, members: meta.members.size
    })));
  });

  socket.on('create_room', ({ room, description, isPrivate }, cb) => {
    room = String(room || '').trim() || 'General';
    if (rooms.has(room)) return cb && cb({ error: 'Room exists' });
    rooms.set(room, { description: description||'No description', isPrivate: !!isPrivate, owner: null, members: new Set(), settings: {} });
    messages.set(room, []);
    io.emit('rooms_list', Array.from(rooms.entries()).map(([name, meta])=>({ name, description: meta.description, members: meta.members.size })));
    cb && cb({ ok:true });
  });

  socket.on('joinRoom', ({ username, room, color, status }, cb) => {
    username = String(username || '').trim();
    room = String(room || 'General').trim() || 'General';
    if (!username) return cb && cb({ error: 'Username required' });
    ensureRoom(room);
    const meta = rooms.get(room);
    if (Array.from(meta.members).includes(username)) return cb && cb({ error: 'Username taken in room' });

    users.set(socket.id, { username, room, color: color||null, status: status||'Active' });
    meta.members.add(username);
    socket.join(room);

    // send last 100 messages
    const last = (messages.get(room) || []).slice(-100);
    socket.emit('init_room', { room, users: Array.from(meta.members), messages: last, roomMeta: { description: meta.description } });

    socket.to(room).emit('system_message', { text: `${username} joined`, time: Date.now() });
    io.to(room).emit('roomUsers', Array.from(meta.members));
    io.emit('rooms_list', Array.from(rooms.entries()).map(([name, meta])=>({ name, description: meta.description, members: meta.members.size })));
    cb && cb({ ok:true });
  });

  socket.on('chatMessage', (payload, cb) => {
    const u = users.get(socket.id);
    if (!u) return cb && cb({ error: 'Not joined' });
    let text = String(payload.text || '').trim();
    const replyTo = payload.replyTo || null;
    const file = payload.file || null;
    const mentions = payload.mentions || [];
    // basic formatting (server lets html through because client sanitizes; production require sanitization)
    if(!text && !file) return cb && cb({ error: 'Empty message' });
    const msg = { id: genId(), user: u.username, text, time: Date.now(), edited: false, replyTo, file, reactions: {}, threadId: null, mentions };
    ensureRoom(u.room);
    messages.get(u.room).push(msg);
    // keep limited
    if (messages.get(u.room).length > 500) messages.get(u.room).shift();
    io.to(u.room).emit('newMessage', msg);
    cb && cb({ ok:true, id: msg.id });
  });

  socket.on('editMessage', ({ msgId, newText }, cb) => {
    const u = users.get(socket.id);
    if (!u) return cb && cb({ error: 'Not joined' });
    const roomMsgs = messages.get(u.room) || [];
    const m = roomMsgs.find(x=>x.id===msgId);
    if(!m) return cb && cb({ error: 'Message not found' });
    if(m.user !== u.username) return cb && cb({ error: 'Not owner' });
    m.text = String(newText||'').trim();
    m.edited = true;
    io.to(u.room).emit('updateMessage', m);
    cb && cb({ ok:true });
  });

  socket.on('deleteMessage', (msgId, cb) => {
    const u = users.get(socket.id);
    if (!u) return cb && cb({ error: 'Not joined' });
    const arr = messages.get(u.room) || [];
    const idx = arr.findIndex(x=>x.id===msgId);
    if (idx === -1) return cb && cb({ error: 'Not found' });
    const m = arr[idx];
    if (m.user !== u.username) return cb && cb({ error: 'Not owner' });
    arr.splice(idx,1);
    io.to(u.room).emit('deleteMessage', { msgId });
    cb && cb({ ok:true });
  });

  socket.on('reactMessage', ({ msgId, emoji }, cb) => {
    const u = users.get(socket.id);
    if (!u) return cb && cb({ error: 'Not joined' });
    const arr = messages.get(u.room) || [];
    const m = arr.find(x=>x.id===msgId);
    if(!m) return cb && cb({ error: 'Not found' });
    m.reactions[emoji] = m.reactions[emoji] || [];
    const idx = m.reactions[emoji].indexOf(u.username);
    if (idx === -1) m.reactions[emoji].push(u.username);
    else m.reactions[emoji].splice(idx,1);
    io.to(u.room).emit('updateReactions', { msgId, reactions: m.reactions });
    cb && cb({ ok:true });
  });

  socket.on('typing', () => {
    const u = users.get(socket.id);
    if (!u) return;
    socket.to(u.room).emit('typing', { user: u.username });
  });

  socket.on('stopTyping', () => {
    const u = users.get(socket.id);
    if (!u) return;
    socket.to(u.room).emit('stopTyping', { user: u.username });
  });

  // upload file as base64 payload
  socket.on('uploadFile', ({ filename, mimetype, b64data }, cb) => {
    const u = users.get(socket.id);
    if (!u) return cb && cb({ error: 'Not joined' });
    const file = { filename, mimetype, url: `data:${mimetype};base64,${b64data}` };
    const msg = { id: genId(), user: u.username, text: '', time: Date.now(), edited:false, replyTo:null, file, reactions: {}, threadId:null };
    messages.get(u.room).push(msg);
    io.to(u.room).emit('newMessage', msg);
    cb && cb({ ok:true });
  });

  // threads
  socket.on('createThread', ({ parentMsgId, text }, cb)=> {
    const u = users.get(socket.id);
    if(!u) return cb && cb({ error:'Not joined' });
    const threadId = genId();
    threads.set(threadId, { parentMsgId, room: u.room, messages: [] });
    // optionally add first message
    if(text) {
      const msg = { id: genId(), user: u.username, text, time: Date.now(), edited:false, replyTo: parentMsgId, file:null, reactions:{}, threadId };
      threads.get(threadId).messages.push(msg);
    }
    cb && cb({ ok:true, threadId });
    io.to(u.room).emit('threadCreated', { threadId, parentMsgId });
  });

  socket.on('threadMessage', ({ threadId, text }, cb) => {
    const u = users.get(socket.id);
    if(!u) return cb && cb({ error:'Not joined' });
    const t = threads.get(threadId);
    if(!t) return cb && cb({ error:'No thread' });
    const msg = { id: genId(), user: u.username, text, time: Date.now(), edited:false, file:null };
    t.messages.push(msg);
    io.to(u.room).emit('threadMessage', { threadId, msg });
    cb && cb({ ok:true });
  });

  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if(!u) return;
    const { username, room } = u;
    // remove member
    const meta = rooms.get(room);
    if (meta) {
      meta.members.delete(username);
      io.to(room).emit('system_message', { text: `${username} left`, time: Date.now() });
      io.to(room).emit('roomUsers', Array.from(meta.members));
    }
    users.delete(socket.id);
    io.emit('rooms_list', Array.from(rooms.entries()).map(([name, meta])=>({ name, description: meta.description, members: meta.members.size })));
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('listening', PORT));
