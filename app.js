const { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_NAME, CHAT_RETENTION_DAYS } = window.ANZ_CONFIG || {};
const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes('PROJECT-ID') && !SUPABASE_ANON_KEY.includes('ISI_SUPABASE'));
const client = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
const $ = (id) => document.getElementById(id);
const els = {
  authLayout: $('authLayout'), chatLayout: $('chatLayout'), authForm: $('authForm'), authHeading: $('authHeading'), authSubheading: $('authSubheading'),
  loginTab: $('loginTab'), registerTab: $('registerTab'), passwordConfirmField: $('passwordConfirmField'), authSubmit: $('authSubmit'), authStatus: $('authStatus'),
  username: $('username'), password: $('password'), passwordConfirm: $('passwordConfirm'), forgotButton: $('forgotButton'), forgotForm: $('forgotForm'),
  forgotUsername: $('forgotUsername'), forgotContact: $('forgotContact'), forgotReason: $('forgotReason'), forgotSubmit: $('forgotSubmit'), forgotStatus: $('forgotStatus'),
  userAvatar: $('userAvatar'), signedUsername: $('signedUsername'), logoutButton: $('logoutButton'), chatFeed: $('chatFeed'), chatForm: $('chatForm'),
  chatMessage: $('chatMessage'), chatStatus: $('chatStatus'), connectionLabel: $('connectionLabel'),
};
let authMode = 'login';
let activeUser = null;
let activeUsername = null;
let realtimeChannel = null;
const retentionDays = Number(CHAT_RETENTION_DAYS || 7);
if ($('year')) $('year').textContent = new Date().getFullYear();

function normalizeUsername(raw) { return String(raw || '').trim().toLowerCase(); }
function usernameEmail(username) { return `${normalizeUsername(username)}@accounts.anzmuach.online`; }
function showStatus(el, message, isError = false) {
  el.textContent = message;
  el.classList.remove('hidden', 'error');
  if (isError) el.classList.add('error');
}
function hideStatus(el) { el.textContent = ''; el.classList.add('hidden'); el.classList.remove('error'); }
function setConfiguredState() {
  if (!configured) {
    showStatus(els.authStatus, 'Website belum disambungkan ke Supabase. Isi public/config.js dengan Project URL dan publishable/anon key, lalu konfigurasi database sesuai README.', true);
    els.authSubmit.disabled = true;
    els.forgotSubmit.disabled = true;
  }
}
function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  els.loginTab.classList.toggle('active', !registering);
  els.registerTab.classList.toggle('active', registering);
  els.authHeading.textContent = registering ? 'Buat akun Anz' : 'Masuk ke Anz';
  els.authSubheading.textContent = registering ? 'Pilih username dan password-mu.' : 'Lanjutkan obrolanmu.';
  els.passwordConfirmField.classList.toggle('hidden', !registering);
  els.password.autocomplete = registering ? 'new-password' : 'current-password';
  els.authSubmit.textContent = registering ? 'Buat akun ↗' : 'Masuk ke chat ↗';
  hideStatus(els.authStatus);
}
els.loginTab.addEventListener('click', () => setAuthMode('login'));
els.registerTab.addEventListener('click', () => setAuthMode('register'));
els.forgotButton.addEventListener('click', () => {
  els.forgotForm.classList.toggle('hidden');
  if (!els.forgotForm.classList.contains('hidden')) {
    els.forgotUsername.value = els.username.value.trim();
    els.forgotUsername.focus();
  }
});

async function openChat(session) {
  if (!client || !session?.user) return;
  const { data: profile, error } = await client.from('profiles').select('id,username,role').eq('id', session.user.id).single();
  if (error || !profile) {
    showStatus(els.authStatus, 'Akun masuk, tetapi profil belum terbentuk. Pastikan SQL Supabase sudah dijalankan, lalu coba keluar dan login lagi.', true);
    return;
  }
  activeUser = session.user;
  activeUsername = profile.username;
  els.authLayout.classList.add('hidden');
  els.chatLayout.classList.remove('hidden');
  els.signedUsername.textContent = activeUsername;
  els.userAvatar.textContent = activeUsername.slice(0, 1).toUpperCase();
  els.connectionLabel.textContent = 'Memuat chat...';
  await loadMessages();
  subscribeToMessages();
  els.chatMessage.focus();
}
async function tryExistingSession() {
  if (!client) return;
  const { data } = await client.auth.getSession();
  if (data.session) await openChat(data.session);
}
els.authForm.addEventListener('submit', async (event) => {
  event.preventDefault(); hideStatus(els.authStatus);
  if (!client) return setConfiguredState();
  const username = normalizeUsername(els.username.value);
  const password = els.password.value;
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return showStatus(els.authStatus, 'Username harus 3–24 karakter. Pakai huruf, angka, titik, garis bawah, atau minus.', true);
  if (password.length < 8) return showStatus(els.authStatus, 'Password minimal 8 karakter ya.', true);
  if (authMode === 'register' && password !== els.passwordConfirm.value) return showStatus(els.authStatus, 'Konfirmasi password belum sama.', true);
  els.authSubmit.disabled = true;
  els.authSubmit.textContent = authMode === 'register' ? 'Membuat akun...' : 'Sedang masuk...';
  try {
    if (authMode === 'register') {
      const { data, error } = await client.auth.signUp({
        email: usernameEmail(username), password,
        options: { data: { username }, emailRedirectTo: window.location.href.split('#')[0] }
      });
      if (error) throw error;
      if (data.session) {
        showStatus(els.authStatus, 'Akun berhasil dibuat. Membuka chat...');
        await openChat(data.session);
      } else {
        showStatus(els.authStatus, 'Akun tercatat, tetapi Supabase masih meminta konfirmasi email. Untuk sistem username tanpa email, matikan Email Confirmations di pengaturan Auth Supabase, lalu coba daftar lagi.', true);
      }
    } else {
      const { data, error } = await client.auth.signInWithPassword({ email: usernameEmail(username), password });
      if (error) throw error;
      await openChat(data.session);
    }
  } catch (error) {
    const msg = String(error?.message || 'Terjadi kesalahan. Coba lagi.');
    const duplicate = /already registered|duplicate key|profiles_username_key|unique constraint/i.test(msg);
    showStatus(els.authStatus, duplicate ? 'Username itu sudah dipakai. Coba username lain ya.' : (authMode === 'login' ? 'Login gagal. Periksa username dan password kamu.' : `Gagal membuat akun: ${msg}`), true);
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.textContent = authMode === 'register' ? 'Buat akun ↗' : 'Masuk ke chat ↗';
  }
});

els.forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault(); hideStatus(els.forgotStatus);
  if (!client) return showStatus(els.forgotStatus, 'Website belum disambungkan ke Supabase.', true);
  const username = normalizeUsername(els.forgotUsername.value);
  const contact = els.forgotContact.value.trim();
  const reason = els.forgotReason.value.trim();
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return showStatus(els.forgotStatus, 'Masukkan username akun dengan format yang benar.', true);
  els.forgotSubmit.disabled = true; els.forgotSubmit.textContent = 'Mengirim...';
  try {
    const { data, error } = await client.functions.invoke('request-password-reset', { body: { username, contact: contact || null, reason: reason || null } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Permintaan tidak terkirim.');
    showStatus(els.forgotStatus, 'Permintaan terkirim. Hubungi admin Anz melalui kontak resmi dan sebutkan username kamu. Admin akan memverifikasi sebelum mereset password.');
    els.forgotForm.reset();
  } catch (error) {
    showStatus(els.forgotStatus, `Permintaan tidak terkirim: ${error?.message || 'coba lagi nanti'}`, true);
  } finally {
    els.forgotSubmit.disabled = false; els.forgotSubmit.textContent = 'Kirim permintaan reset';
  }
});

function addMessageElement(message) {
  const node = document.createElement('article');
  node.className = `message${message.user_id === activeUser?.id ? ' mine' : ''}`;
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const author = document.createElement('strong'); author.textContent = message.username || 'Anggota';
  const time = document.createElement('time'); time.dateTime = message.created_at;
  const dt = new Date(message.created_at);
  time.textContent = dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  meta.append(author, time);
  const body = document.createElement('div'); body.className = 'message-body'; body.textContent = message.content;
  node.append(meta, body); return node;
}
async function loadMessages() {
  if (!client) return;
  const since = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client.from('messages').select('id,user_id,username,content,created_at').gte('created_at', since).order('created_at', { ascending: true }).limit(200);
  if (error) {
    els.chatFeed.replaceChildren();
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Belum bisa memuat chat. Pastikan tabel dan aturan keamanan Supabase sudah disiapkan.'; els.chatFeed.append(empty);
    els.connectionLabel.textContent = 'Gagal memuat'; return;
  }
  els.chatFeed.replaceChildren();
  if (!data?.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    const mark = document.createElement('div'); mark.className = 'mark'; mark.textContent = '✦';
    const strong = document.createElement('strong'); strong.textContent = 'Ruangnya masih tenang.';
    const p = document.createElement('p'); p.textContent = 'Jadi yang pertama menyapa 👋';
    empty.append(mark, strong, p); els.chatFeed.append(empty);
  } else data.forEach((msg) => els.chatFeed.append(addMessageElement(msg)));
  els.chatFeed.scrollTop = els.chatFeed.scrollHeight;
  els.connectionLabel.textContent = 'Terhubung';
}
function subscribeToMessages() {
  if (!client || realtimeChannel) return;
  realtimeChannel = client.channel('anz-community-messages').on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadMessages()).subscribe((status) => {
    if (status === 'SUBSCRIBED') els.connectionLabel.textContent = 'Live';
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') els.connectionLabel.textContent = 'Koneksi terputus';
  });
}
els.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault(); hideStatus(els.chatStatus);
  if (!client || !activeUser || !activeUsername) return;
  const content = els.chatMessage.value.trim();
  if (!content) return;
  if (content.length > 1000) return showStatus(els.chatStatus, 'Pesan maksimal 1000 karakter.', true);
  const submit = els.chatForm.querySelector('button'); submit.disabled = true;
  try {
    const { error } = await client.from('messages').insert({ user_id: activeUser.id, username: activeUsername, content });
    if (error) throw error;
    els.chatMessage.value = '';
    await loadMessages();
  } catch (error) {
    showStatus(els.chatStatus, `Pesan gagal dikirim: ${error?.message || 'coba lagi'}`, true);
  } finally { submit.disabled = false; els.chatMessage.focus(); }
});
els.logoutButton.addEventListener('click', async () => {
  if (realtimeChannel && client) { await client.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (client) await client.auth.signOut();
  activeUser = null; activeUsername = null;
  els.chatLayout.classList.add('hidden'); els.authLayout.classList.remove('hidden');
  els.password.value = ''; setAuthMode('login');
});
setConfiguredState();
tryExistingSession();
