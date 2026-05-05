import express from 'express';
import http from 'node:http';
import cors from 'cors';
import { Server } from 'socket.io';
import {
  BOOST,
  createMatchState,
  resolveAction,
  applyBoostDash,
  applyBoostStep,
  applyVerticalThrust,
  tickMatch,
  TICK_RATE_MS,
  interpolateSnapshot
} from '@gvg/shared/src/gameLogic.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const lobby = {
  players: new Map(),
  match: createMatchState(),
  previousSnapshot: null,
  pendingInputs: new Map()
};

function enqueueInput(actorId, payload) {
  if (!lobby.pendingInputs.has(actorId)) lobby.pendingInputs.set(actorId, []);
  const queue = lobby.pendingInputs.get(actorId);
  queue.push(payload);
  if (queue.length > 30) queue.splice(0, queue.length - 30);
}

function applyQueuedInputs(now) {
  for (const [actorId, queue] of lobby.pendingInputs.entries()) {
    const actor = lobby.match.fighters[actorId];
    const defender = lobby.match.fighters[actorId === 'p1' ? 'p2' : 'p1'];
    if (!actor || !defender || queue.length === 0) continue;

    let latestMove = null;

    for (const { type, move, vertical } of queue) {
      if (type === 'MOVE_VECTOR') {
        latestMove = move;
        continue;
      }
      if (type === 'BOOST_DASH') {
        applyBoostDash(actor, move ?? { x: actor.facing, z: 0 }, now);
        continue;
      }
      if (type === 'BOOST_STEP') {
        applyBoostStep(actor, move ?? { x: actor.facing, z: 0 }, now);
        continue;
      }
      if (type === 'VERTICAL_THRUST') {
        applyVerticalThrust(actor, Math.max(0, vertical ?? 0), now);
        continue;
      }
      resolveAction(actor, defender, type, now, lobby.match.projectiles);
    }

    if (latestMove) {
      const mx = latestMove.x ?? 0;
      const mz = latestMove.z ?? 0;
      actor.vx = mx * BOOST.cruiseSpeed;
      actor.vz = mz * BOOST.cruiseSpeed;
      actor.facing = mx >= 0 ? 1 : -1;
    }

    queue.length = 0;
  }
}

function getSnapshot(now) {
  return {
    tick: lobby.match.tick,
    serverTime: now,
    fighters: lobby.match.fighters,
    projectiles: lobby.match.projectiles
  };
}

function broadcastSnapshot() {
  const now = Date.now();
  applyQueuedInputs(now);
  tickMatch(lobby.match, now);

  const snapshot = getSnapshot(now);
  const smoothed = interpolateSnapshot(lobby.previousSnapshot, snapshot, 0.55) ?? snapshot;
  lobby.previousSnapshot = snapshot;

  io.emit('match:snapshot', smoothed);
}

setInterval(broadcastSnapshot, TICK_RATE_MS);

io.on('connection', (socket) => {
  const playerId = lobby.players.size === 0 ? 'p1' : 'p2';
  lobby.players.set(socket.id, playerId);

  socket.emit('player:assigned', {
    playerId,
    mode: 'online-ready'
  });

  socket.on('input:action', ({ type, move, vertical }) => {
    const actorId = lobby.players.get(socket.id);
    if (!actorId) return;
    enqueueInput(actorId, { type, move, vertical });
  });

  socket.on('disconnect', () => {
    const actorId = lobby.players.get(socket.id);
    lobby.players.delete(socket.id);
    if (actorId) lobby.pendingInputs.delete(actorId);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`GVG server listening on ${PORT}`);
});
