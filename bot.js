require('dotenv').config(); const { Telegraf, Markup } = require('telegraf'); const axios = require('axios'); const fs = require('fs'); const { exec } = require('child_process'); const path = require('path'); const simpleGit = require('simple-git');

const bot = new Telegraf(process.env.BOT_TOKEN); const sessions = new Map();

function getSession(id) { if (!sessions.has(id)) sessions.set(id, {}); return sessions.get(id); }

function clearSession(id) { sessions.delete(id); }

async function validateCloudflare(token, accountId, zoneId) { try { const headers = { Authorization: Bearer ${token} }; const accountRes = await axios.get( https://api.cloudflare.com/client/v4/accounts/${accountId}, { headers } ); const zoneRes = await axios.get( https://api.cloudflare.com/client/v4/zones/${zoneId}, { headers } ); return accountRes.data.success && zoneRes.data.success; } catch (e) { return false; } }

function mainMenu() { return Markup.inlineKeyboard([ [Markup.button.callback('🌐 GitHub → Cloudflare', 'github')], [Markup.button.callback('📁 Upload File ke Cloudflare', 'upload_file')], [Markup.button.callback('🧠 Upload Kode ke Cloudflare', 'upload_code')], [Markup.button.callback('📄 List Worker', 'list_worker')], [Markup.button.callback('🗑️ Hapus Worker', 'delete_worker')], [Markup.button.callback('🚪 Logout', 'logout')], ]); }

async function deployGitHubToCloudflare(repoUrl, workerName, session, ctx) { const repoName = repoUrl.split('/').pop().replace(/.git$/, ''); const repoPath = path.join(__dirname, 'tmp', ${ctx.from.id}-${Date.now()}); try { await simpleGit().clone(repoUrl, repoPath);

const wranglerToml = `

name = "${workerName}" type = "javascript" account_id = "${session.accountId}" zone_id = "${session.zoneId}" route = "" workers_dev = true `; fs.writeFileSync(path.join(repoPath, 'wrangler.toml'), wranglerToml);

return new Promise((resolve, reject) => {
  exec(`npx wrangler publish`, { cwd: repoPath, env: { CLOUDFLARE_API_TOKEN: session.token } }, (err, stdout, stderr) => {
    if (err) {
      reject(stderr);
    } else {
      resolve(stdout);
    }
  });
});

} catch (err) { throw new Error(Deploy gagal: ${err.message}); } }

bot.start(async (ctx) => { const userId = ctx.from.id; clearSession(userId); sessions.set(userId, { step: 'awaiting_token' }); await ctx.reply('Selamat datang! Untuk mulai, silakan login ke akun Cloudflare Anda.\n\nKirim API Token kamu:', { parse_mode: 'Markdown' }); });

bot.on('text', async (ctx) => { const userId = ctx.from.id; const session = getSession(userId); const text = ctx.message.text.trim();

switch (session.step) { case 'awaiting_token': session.token = text; session.step = 'awaiting_account_id'; return ctx.reply('Sekarang kirim Account ID Cloudflare kamu:', { parse_mode: 'Markdown' });

case 'awaiting_account_id':
  session.accountId = text;
  session.step = 'awaiting_zone_id';
  return ctx.reply('Terakhir, kirim *Zone ID* Cloudflare kamu:', { parse_mode: 'Markdown' });

case 'awaiting_zone_id':
  session.zoneId = text;
  await ctx.reply('Mengecek kredensial ke Cloudflare...');
  const valid = await validateCloudflare(session.token, session.accountId, session.zoneId);
  if (valid) {
    session.step = 'logged_in';
    return ctx.reply('✅ Login berhasil!', mainMenu());
  } else {
    clearSession(userId);
    return ctx.reply('❌ Login gagal. Token, Account ID, atau Zone ID salah. Ulangi dengan /start');
  }

case 'awaiting_github_link':
  session.githubLink = text;
  session.step = 'awaiting_worker_name';
  return ctx.reply('Masukkan *nama Worker* yang ingin digunakan:', { parse_mode: 'Markdown' });

case 'awaiting_worker_name':
  session.workerName = text;
  await ctx.reply('🚀 Memulai deploy dari GitHub ke Cloudflare...');
  try {
    const result = await deployGitHubToCloudflare(session.githubLink, session.workerName, session, ctx);
    session.step = 'logged_in';
    return ctx.reply(`✅ Deploy berhasil untuk *${session.workerName}*\n${result}`, { parse_mode: 'Markdown', ...mainMenu() });
  } catch (err) {
    session.step = 'logged_in';
    return ctx.reply(`❌ Deploy gagal:\n${err.message}`, mainMenu());
  }

case 'awaiting_delete_worker':
  try {
    await axios.delete(
      `https://api.cloudflare.com/client/v4/accounts/${session.accountId}/workers/scripts/${text}`,
      { headers: { Authorization: `Bearer ${session.token}` } }
    );
    session.step = 'logged_in';
    return ctx.reply(`✅ Worker *${text}* berhasil dihapus.`, { parse_mode: 'Markdown', ...mainMenu() });
  } catch (e) {
    return ctx.reply('❌ Gagal menghapus worker. Pastikan nama benar.');
  }

default:
  return ctx.reply('Gunakan /start untuk mulai atau klik menu yang tersedia.');

} });

bot.on('callback_query', async (ctx) => { const userId = ctx.from.id; const session = getSession(userId); const data = ctx.callbackQuery.data;

if (session.step !== 'logged_in') { return ctx.answerCbQuery('Silakan login dulu dengan /start'); }

switch (data) { case 'logout': clearSession(userId); return ctx.editMessageText('🚪 Kamu sudah logout. Ketik /start untuk login lagi.');

case 'github':
  session.step = 'awaiting_github_link';
  return ctx.editMessageText('Silakan kirim link GitHub project Cloudflare Worker kamu.');

case 'upload_file':
  session.step = 'awaiting_upload_file';
  return ctx.editMessageText('Kirim file ZIP atau JS/HTML untuk di-deploy ke Cloudflare.');

case 'upload_code':
  session.step = 'awaiting_upload_code';
  return ctx.editMessageText('Ketik atau paste kode yang ingin di-deploy ke Cloudflare.');

case 'list_worker':
  try {
    const res = await axios.get(
      `https://api.cloudflare.com/client/v4/accounts/${session.accountId}/workers/scripts`,
      { headers: { Authorization: `Bearer ${session.token}` } }
    );
    if (res.data.success) {
      const workers = res.data.result.map(w => `• ${w.id}`).join('\n');
      return ctx.editMessageText(`📄 *Daftar Worker:*

${workers}`, { parse_mode: 'Markdown' }); } else { throw new Error(); } } catch (e) { return ctx.reply('❌ Gagal mengambil daftar worker.'); }

case 'delete_worker':
  session.step = 'awaiting_delete_worker';
  return ctx.editMessageText('Ketik nama Worker yang ingin kamu hapus:');

default:
  return ctx.answerCbQuery('Fitur belum tersedia.');

} });

bot.launch(); console.log('🤖 Bot aktif...');

