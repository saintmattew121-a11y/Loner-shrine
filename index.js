import http from 'http'
http.createServer((_, res) => res.end('ok')).listen(process.env.PORT || 3000)makeWASocket, {
  useMultiFileAuthState,
  downloadMediaMessage,
  normalizeMessageContent,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import yts from 'yt-search'
import ytdl from '@distube/ytdl-core'
import { Sticker, StickerTypes } from 'wa-sticker-formatter'

const BOT = 'Loner Shrine'
const PREFIX = '.'
const OWNER = (process.env.OWNER_NUMBER || '').replace(/\D/g, '') // e.g. 15551234567
const OWNER_JID = OWNER + '@s.whatsapp.net'
const AI_KEY = process.env.ANTHROPIC_API_KEY

const settings = { autoViewOnce: true, autoStatus: false }
const log = pino({ level: 'silent' })

// ---------- helpers ----------
const MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
}

const mediaType = (content) => Object.keys(MEDIA).find((k) => content?.[k])

async function grab(msg) {
  const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: log })
  return buf
}

async function sendMedia(sock, jid, type, buf, caption = '') {
  const kind = MEDIA[type]
  if (kind === 'audio') return sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg' })
  return sock.sendMessage(jid, { [kind]: buf, caption })
}

async function toBuffer(stream) {
  const chunks = []
  for await (const c of stream) chunks.push(c)
  return Buffer.concat(chunks)
}

async function ask(prompt, system = `You are ${BOT}, a concise, witty WhatsApp assistant.`) {
  if (!AI_KEY) return 'AI is not set up. Add ANTHROPIC_API_KEY.'
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': AI_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const d = await r.json()
  return d.content?.map((b) => b.text || '').join('') || 'No response.'
}

// build a downloadable message from a reply's context
function quotedAsMessage(m, ctx) {
  return {
    key: {
      remoteJid: m.key.remoteJid,
      id: ctx.stanzaId,
      participant: ctx.participant,
    },
    message: ctx.quotedMessage,
  }
}

// ---------- commands ----------
const commands = {
  async menu({ sock, jid, m }) {
    const text = `╭─❖ *${BOT}* ❖─╮
*Media*
 ${PREFIX}open  – reply to a view-once to reveal it
 ${PREFIX}save  – reply to any media/status to save it
 ${PREFIX}status on|off – auto-save contact statuses
 ${PREFIX}vo on|off – auto-save view-once
*Music & Video*
 ${PREFIX}play <song>  – audio
 ${PREFIX}video <query> – video
 ${PREFIX}yts <query>  – search
*AI*
 ${PREFIX}ai <question>
 ${PREFIX}tr <lang> <text>  – translate
 ${PREFIX}sum  – summarise replied text
 ${PREFIX}roast <name>
 ${PREFIX}joke
*Stickers*
 ${PREFIX}sticker – reply to / send an image or short video
 ${PREFIX}toimg – reply to a sticker
*Group (admins)*
 ${PREFIX}tagall  ${PREFIX}hidetag <text>
 ${PREFIX}kick  ${PREFIX}add <number>
 ${PREFIX}promote  ${PREFIX}demote
 ${PREFIX}nuke – remove everyone except the creator
 ${PREFIX}mute  ${PREFIX}unmute
 ${PREFIX}link  ${PREFIX}ginfo
 ${PREFIX}antilink on|off
 ${PREFIX}welcome on|off
*Tools*
 ${PREFIX}ping  ${PREFIX}owner  ${PREFIX}menu
╰───────────╯`
    await sock.sendMessage(jid, { text }, { quoted: m })
  },

  async ping({ sock, jid, m }) {
    await sock.sendMessage(jid, { text: `🏓 ${BOT} is alive.` }, { quoted: m })
  },

  async owner({ sock, jid, m }) {
    await sock.sendMessage(jid, { text: `Owner: wa.me/${OWNER}` }, { quoted: m })
  },

  // .open — reply to a view-once message; media goes to the owner's chat
  async open({ sock, m, ctx, isOwner }) {
    if (!isOwner) return
    if (!ctx?.quotedMessage) return sock.sendMessage(OWNER_JID, { text: 'Reply to a view-once with .open' })
    const q = quotedAsMessage(m, ctx)
    const content = normalizeMessageContent(q.message)
    const type = mediaType(content)
    if (!type) return sock.sendMessage(OWNER_JID, { text: 'That is not a media message.' })
    const buf = await grab(q)
    await sendMedia(sock, OWNER_JID, type, buf, content[type].caption || '')
  },

  // .save — works on any media, including a replied status
  async save({ sock, m, ctx, isOwner }) {
    if (!isOwner) return
    if (!ctx?.quotedMessage) return sock.sendMessage(OWNER_JID, { text: 'Reply to media or a status with .save' })
    const q = quotedAsMessage(m, ctx)
    const content = normalizeMessageContent(q.message)
    const type = mediaType(content)
    if (!type) {
      const t = content?.conversation || content?.extendedTextMessage?.text
      return sock.sendMessage(OWNER_JID, { text: t ? `Saved text:\n${t}` : 'Nothing to save.' })
    }
    const buf = await grab(q)
    await sendMedia(sock, OWNER_JID, type, buf, content[type].caption || '')
  },

  async status({ sock, jid, m, args, isOwner }) {
    if (!isOwner) return
    settings.autoStatus = args[0] === 'on'
    await sock.sendMessage(jid, { text: `Status saver: ${settings.autoStatus ? 'ON' : 'OFF'}` }, { quoted: m })
  },

  async vo({ sock, jid, m, args, isOwner }) {
    if (!isOwner) return
    settings.autoViewOnce = args[0] !== 'off'
    await sock.sendMessage(jid, { text: `Auto view-once save: ${settings.autoViewOnce ? 'ON' : 'OFF'}` }, { quoted: m })
  },

  async play({ sock, jid, m, text }) {
    if (!text) return sock.sendMessage(jid, { text: 'Usage: .play <song name>' }, { quoted: m })
    const { videos } = await yts(text)
    const v = videos[0]
    if (!v) return sock.sendMessage(jid, { text: 'Nothing found.' }, { quoted: m })
    if (v.seconds > 900) return sock.sendMessage(jid, { text: 'Too long (max 15 min).' }, { quoted: m })
    await sock.sendMessage(jid, { text: `🎵 ${v.title}\n⏱ ${v.timestamp}` }, { quoted: m })
    const buf = await toBuffer(ytdl(v.url, { filter: 'audioonly', quality: 'highestaudio' }))
    await sock.sendMessage(jid, { audio: buf, mimetype: 'audio/mpeg' }, { quoted: m })
  },

  async video({ sock, jid, m, text }) {
    if (!text) return sock.sendMessage(jid, { text: 'Usage: .video <query>' }, { quoted: m })
    const { videos } = await yts(text)
    const v = videos[0]
    if (!v) return sock.sendMessage(jid, { text: 'Nothing found.' }, { quoted: m })
    if (v.seconds > 600) return sock.sendMessage(jid, { text: 'Too long (max 10 min).' }, { quoted: m })
    const buf = await toBuffer(ytdl(v.url, { quality: '18' })) // 360p mp4
    await sock.sendMessage(jid, { video: buf, caption: v.title }, { quoted: m })
  },

  async yts({ sock, jid, m, text }) {
    const { videos } = await yts(text || '')
    const out = videos.slice(0, 5).map((v, i) => `${i + 1}. ${v.title} (${v.timestamp})\n${v.url}`).join('\n\n')
    await sock.sendMessage(jid, { text: out || 'Nothing found.' }, { quoted: m })
  },

  async ai({ sock, jid, m, text }) {
    if (!text) return sock.sendMessage(jid, { text: 'Usage: .ai <question>' }, { quoted: m })
    await sock.sendMessage(jid, { text: await ask(text) }, { quoted: m })
  },

  async tr({ sock, jid, m, args }) {
    const [lang, ...rest] = args
    if (!lang || !rest.length) return sock.sendMessage(jid, { text: 'Usage: .tr <language> <text>' }, { quoted: m })
    await sock.sendMessage(jid, { text: await ask(`Translate to ${lang}. Output only the translation:\n${rest.join(' ')}`) }, { quoted: m })
  },

  async sum({ sock, jid, m, ctx }) {
    const t = ctx?.quotedMessage?.conversation || ctx?.quotedMessage?.extendedTextMessage?.text
    if (!t) return sock.sendMessage(jid, { text: 'Reply to a text with .sum' }, { quoted: m })
    await sock.sendMessage(jid, { text: await ask(`Summarise in 3 bullets:\n${t}`) }, { quoted: m })
  },

  async roast({ sock, jid, m, text }) {
    await sock.sendMessage(jid, { text: await ask(`Write a light, friendly one-line roast of ${text || 'me'}. No slurs, nothing cruel.`) }, { quoted: m })
  },

  async joke({ sock, jid, m }) {
    await sock.sendMessage(jid, { text: await ask('Tell me one short clean joke.') }, { quoted: m })
  },
}

// ---------- stickers & group tools ----------
const antilink = new Set()
const welcomeOn = new Set()
const num = (j = '') => j.split('@')[0].split(':')[0]
const targetsOf = (ctx) => [
  ...(ctx?.mentionedJid || []),
  ...(ctx?.quotedMessage && ctx?.participant ? [ctx.participant] : []),
]

// returns group metadata if sender (and bot, when needed) are admins; otherwise replies and returns null
async function adminGate({ sock, jid, m, isOwner }, needBotAdmin = true) {
  if (!jid.endsWith('@g.us')) {
    await sock.sendMessage(jid, { text: 'Groups only.' }, { quoted: m })
    return null
  }
  const meta = await sock.groupMetadata(jid)
  const isAdmin = (n) => meta.participants.some((p) => num(p.id) === n && p.admin)
  if (!isOwner && !isAdmin(num(m.key.participant))) {
    await sock.sendMessage(jid, { text: 'Admins only.' }, { quoted: m })
    return null
  }
  if (needBotAdmin && !isAdmin(num(sock.user.id))) {
    await sock.sendMessage(jid, { text: 'Make me an admin first.' }, { quoted: m })
    return null
  }
  return meta
}

Object.assign(commands, {
  async sticker({ sock, jid, m, ctx, content }) {
    const src = mediaType(content) ? m : ctx?.quotedMessage ? quotedAsMessage(m, ctx) : null
    const c = src && normalizeMessageContent(src.message)
    const t = c && mediaType(c)
    if (!t || t === 'audioMessage') {
      return sock.sendMessage(jid, { text: 'Send or reply to an image / short video with .sticker' }, { quoted: m })
    }
    const buf = await grab(src)
    const s = new Sticker(buf, { pack: BOT, author: 'bot', type: StickerTypes.FULL, quality: 50 })
    await sock.sendMessage(jid, await s.toMessage(), { quoted: m })
  },

  async toimg({ sock, jid, m, ctx }) {
    if (!ctx?.quotedMessage?.stickerMessage) {
      return sock.sendMessage(jid, { text: 'Reply to a sticker with .toimg' }, { quoted: m })
    }
    const buf = await grab(quotedAsMessage(m, ctx))
    await sock.sendMessage(jid, { image: buf }, { quoted: m })
  },

  async tagall(c) {
    const meta = await adminGate(c, false)
    if (!meta) return
    const ids = meta.participants.map((p) => p.id)
    const text = `📢 ${c.text || 'Attention!'}\n\n` + ids.map((i) => `@${num(i)}`).join(' ')
    await c.sock.sendMessage(c.jid, { text, mentions: ids })
  },

  async hidetag(c) {
    const meta = await adminGate(c, false)
    if (!meta) return
    await c.sock.sendMessage(c.jid, { text: c.text || '👀', mentions: meta.participants.map((p) => p.id) })
  },

  async kick(c) {
    if (!(await adminGate(c))) return
    const t = targetsOf(c.ctx)
    if (!t.length) return c.sock.sendMessage(c.jid, { text: 'Reply to or @mention someone.' }, { quoted: c.m })
    await c.sock.groupParticipantsUpdate(c.jid, t, 'remove')
  },

  async add(c) {
    if (!(await adminGate(c))) return
    const n = (c.args[0] || '').replace(/\D/g, '')
    if (!n) return c.sock.sendMessage(c.jid, { text: 'Usage: .add 15551234567' }, { quoted: c.m })
    await c.sock.groupParticipantsUpdate(c.jid, [n + '@s.whatsapp.net'], 'add')
  },

  async promote(c) {
    if (!(await adminGate(c))) return
    const t = targetsOf(c.ctx)
    if (t.length) await c.sock.groupParticipantsUpdate(c.jid, t, 'promote')
  },

  async demote(c) {
    if (!(await adminGate(c))) return
    const t = targetsOf(c.ctx)
    if (t.length) await c.sock.groupParticipantsUpdate(c.jid, t, 'demote')
  },

  async nuke(c) {
    const meta = await adminGate(c)
    if (!meta) return
    const creator = meta.owner || meta.participants.find((p) => p.admin === 'superadmin')?.id
    if (!creator) {
      return c.sock.sendMessage(c.jid, { text: "Couldn't determine the group creator — aborting." }, { quoted: c.m })
    }
    const botId = c.sock.user.id
    const targets = meta.participants.map((p) => p.id).filter((id) => num(id) !== num(creator) && num(id) !== num(botId))
    if (!targets.length) {
      return c.sock.sendMessage(c.jid, { text: 'Nobody to remove.' }, { quoted: c.m })
    }
    await c.sock.sendMessage(c.jid, { text: `💥 Removing ${targets.length} member(s), keeping only the creator...` }, { quoted: c.m })
    // WhatsApp caps bulk removals per call, so chunk it
    for (let i = 0; i < targets.length; i += 20) {
      await c.sock.groupParticipantsUpdate(c.jid, targets.slice(i, i + 20), 'remove')
    }
  },

  async mute(c) {
    if (!(await adminGate(c))) return
    await c.sock.groupSettingUpdate(c.jid, 'announcement')
    await c.sock.sendMessage(c.jid, { text: '🔇 Only admins can send messages now.' })
  },

  async unmute(c) {
    if (!(await adminGate(c))) return
    await c.sock.groupSettingUpdate(c.jid, 'not_announcement')
    await c.sock.sendMessage(c.jid, { text: '🔊 Everyone can send messages.' })
  },

  async link(c) {
    if (!(await adminGate(c))) return
    const code = await c.sock.groupInviteCode(c.jid)
    await c.sock.sendMessage(c.jid, { text: `https://chat.whatsapp.com/${code}` }, { quoted: c.m })
  },

  async ginfo(c) {
    const meta = await adminGate(c, false)
    if (!meta) return
    const admins = meta.participants.filter((p) => p.admin).length
    await c.sock.sendMessage(
      c.jid,
      { text: `*${meta.subject}*\nMembers: ${meta.participants.length}\nAdmins: ${admins}\n\n${meta.desc || ''}` },
      { quoted: c.m }
    )
  },

  async antilink(c) {
    if (!(await adminGate(c))) return
    c.args[0] === 'on' ? antilink.add(c.jid) : antilink.delete(c.jid)
    await c.sock.sendMessage(c.jid, { text: `Antilink: ${antilink.has(c.jid) ? 'ON' : 'OFF'}` }, { quoted: c.m })
  },

  async welcome(c) {
    if (!(await adminGate(c, false))) return
    c.args[0] === 'on' ? welcomeOn.add(c.jid) : welcomeOn.delete(c.jid)
    await c.sock.sendMessage(c.jid, { text: `Welcome message: ${welcomeOn.has(c.jid) ? 'ON' : 'OFF'}` }, { quoted: c.m })
  },
})

// ---------- socket ----------
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./session')
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: state, logger: log, printQRInTerminal: false, browser: [BOT, 'Chrome', '1.0'] })

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(OWNER)
      console.log(`\nPairing code for ${BOT}: ${code}\nWhatsApp > Linked devices > Link with phone number\n`)
    }, 3000)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log(`${BOT} online ✅`)
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) start()
      else console.log('Logged out. Delete ./session and re-pair.')
    }
  })

  sock.ev.on('group-participants.update', async ({ id, participants, action }) => {
    if (action !== 'add' || !welcomeOn.has(id)) return
    const ids = participants.map((p) => (typeof p === 'string' ? p : p.id))
    await sock.sendMessage(id, {
      text: `👋 Welcome to the shrine ${ids.map((i) => '@' + num(i)).join(' ')}`,
      mentions: ids,
    })
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.message) continue
        const jid = m.key.remoteJid
        const content = normalizeMessageContent(m.message)
        const sender = (m.key.participant || jid).split('@')[0].split(':')[0]
        const isOwner = m.key.fromMe || sender === OWNER

        // status saver (auto)
        if (jid === 'status@broadcast') {
          const type = mediaType(content)
          if (settings.autoStatus && type && !m.key.fromMe) {
            const buf = await grab(m)
            await sendMedia(sock, OWNER_JID, type, buf, `📥 Status from ${sender}\n${content[type].caption || ''}`)
          }
          continue
        }

        // auto-save view-once to the owner's chat only
        const type = mediaType(content)
        if (settings.autoViewOnce && type && content[type].viewOnce && !m.key.fromMe) {
          const buf = await grab(m)
          await sendMedia(sock, OWNER_JID, type, buf, `👁 View-once from ${sender}\n${content[type].caption || ''}`)
        }

        // commands
        const body =
          content?.conversation ||
          content?.extendedTextMessage?.text ||
          content?.imageMessage?.caption ||
          content?.videoMessage?.caption ||
          ''
        // antilink: delete group-invite links from non-admins
        if (jid.endsWith('@g.us') && antilink.has(jid) && !isOwner && /chat\.whatsapp\.com\//i.test(body)) {
          const meta = await sock.groupMetadata(jid)
          const senderAdmin = meta.participants.some((p) => num(p.id) === sender && p.admin)
          if (!senderAdmin) {
            await sock.sendMessage(jid, { delete: m.key })
            continue
          }
        }

        if (!body.startsWith(PREFIX)) continue
        const [name, ...args] = body.slice(PREFIX.length).trim().split(/\s+/)
        const cmd = commands[name.toLowerCase()]
        if (!cmd) continue
        const ctx = content?.extendedTextMessage?.contextInfo
        await cmd({ sock, m, jid, args, text: args.join(' '), ctx, isOwner, content })
      } catch (e) {
        console.error('handler error:', e.message)
      }
    }
  })
}

start()
