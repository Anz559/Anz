const cfg = window.ANZ_CONFIG || {};
const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_URL.includes('PROJECT-ID') && !cfg.SUPABASE_ANON_KEY.includes('ISI_SUPABASE'));
const db = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
const $ = (id) => document.getElementById(id);
const loginBox = $('developerLogin'), dashboard = $('developerDashboard'), statusBox = $('devDashboardStatus');
const usernameEmail = (name) => `${String(name || '').trim().toLowerCase()}@accounts.anzmuach.online`;
function status(el, text, error = false) { el.textContent = text; el.classList.remove('hidden', 'error'); if (error) el.classList.add('error'); }
function clearStatus(el) { el.textContent = ''; el.classList.add('hidden'); el.classList.remove('error'); }
let devUser = null;
if (!configured) status($('devLoginStatus'), 'Isi public/config.js dengan Supabase URL dan public key terlebih dahulu.', true);

async function enterDashboard(user) {
  const { data: profile, error } = await db.from('profiles').select('id,username,role').eq('id', user.id).single();
  if (error || profile?.role !== 'developer') {
    await db.auth.signOut();
    status($('devLoginStatus'), 'Akun ini belum memiliki akses Developer Anz.', true);
    return;
  }
  devUser = user;
  loginBox.classList.add('hidden'); dashboard.classList.remove('hidden');
  $('devGreeting').textContent = `Login sebagai @${profile.username}`;
  await Promise.all([loadResetRequests(), loadChatMessages()]);
}
$('devLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); clearStatus($('devLoginStatus'));
  if (!db) return;
  const username = $('devUsername').value.trim().toLowerCase(); const password = $('devPassword').value;
  if (!/^[a-z0-9_.-]{3,24}$/.test(username)) return status($('devLoginStatus'), 'Format username tidak valid.', true);
  $('devLoginSubmit').disabled = true; $('devLoginSubmit').textContent = 'Memeriksa akses...';
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: usernameEmail(username), password });
    if (error) throw error;
    await enterDashboard(data.user);
  } catch (_) { status($('devLoginStatus'), 'Login gagal. Cek username/password atau pastikan akun sudah diberi role developer.', true); }
  finally { $('devLoginSubmit').disabled = false; $('devLoginSubmit').textContent = 'Masuk dashboard ↗'; }
});
async function trySession() { if (!db) return; const { data } = await db.auth.getSession(); if (data.session) await enterDashboard(data.session.user); }
async function loadResetRequests() {
  const list = $('resetRequestList'); list.replaceChildren();
  const { data, error } = await db.from('password_reset_requests').select('id,username,contact,reason,status,created_at').order('created_at', { ascending: false }).limit(80);
  if (error) { const p = document.createElement('span'); p.className = 'help'; p.textContent = 'Tidak bisa memuat permintaan. Periksa SQL dan RLS.'; list.append(p); return; }
  if (!data?.length) { const p = document.createElement('span'); p.className = 'help'; p.textContent = 'Belum ada permintaan reset password.'; list.append(p); return; }
  for (const item of data) {
    const card = document.createElement('article'); card.className = 'request-item';
    const title = document.createElement('strong'); title.textContent = `@${item.username}`;
    const meta = document.createElement('small'); meta.textContent = `${item.status.toUpperCase()} · ${new Date(item.created_at).toLocaleString('id-ID')}${item.contact ? ` · Kontak: ${item.contact}` : ''}${item.reason ? ` · ${item.reason}` : ''}`;
    card.append(title, meta);
    if (item.status === 'pending') {
      const actions = document.createElement('div'); actions.className = 'request-actions';
      const reset = document.createElement('button'); reset.className = 'btn btn-primary'; reset.textContent = 'Reset password';
      reset.addEventListener('click', async () => {
        const confirmed = window.confirm(`Pastikan identitas pemilik akun @${item.username} sudah diverifikasi lewat jalur lain. Lanjutkan?`);
        if (!confirmed) return;
        const temporaryPassword = window.prompt('Buat password sementara baru (minimal 8 karakter). Jangan gunakan password milikmu.');
        if (temporaryPassword === null) return;
        if (temporaryPassword.length < 8 || temporaryPassword.length > 72) return status(statusBox, 'Password sementara harus 8–72 karakter.', true);
        reset.disabled = true; reset.textContent = 'Memproses...';
        try {
          const { data: result, error: fnError } = await db.functions.invoke('developer-reset-password', { body: { requestId: item.id, newPassword: temporaryPassword } });
          if (fnError) throw fnError;
          if (!result?.ok) throw new Error(result?.error || 'Reset gagal.');
          status(statusBox, `Password akun @${item.username} berhasil direset. Password sementara: ${temporaryPassword} — salin dan kirim secara pribadi hanya setelah identitas pemilik akun diverifikasi.`);
          await loadResetRequests();
        } catch (err) {
          status(statusBox, `Reset gagal: ${err?.message || 'periksa Edge Function'}`, true);
          reset.disabled = false; reset.textContent = 'Reset password';
        }
      });
      const reject = document.createElement('button'); reject.className = 'btn btn-outline'; reject.textContent = 'Tolak';
      reject.addEventListener('click', async () => {
        if (!window.confirm(`Tolak permintaan @${item.username}?`)) return;
        const { error: updateError } = await db.from('password_reset_requests').update({ status: 'rejected', handled_by: devUser.id, handled_at: new Date().toISOString() }).eq('id', item.id);
        if (updateError) status(statusBox, `Tidak bisa menolak permintaan: ${updateError.message}`, true); else { status(statusBox, 'Permintaan ditandai ditolak.'); await loadResetRequests(); }
      });
      actions.append(reset, reject); card.append(actions);
    }
    list.append(card);
  }
}
async function loadChatMessages() {
  const list = $('adminMessageList'); list.replaceChildren();
  const since = new Date(Date.now() - (Number(cfg.CHAT_RETENTION_DAYS || 7) * 86400000)).toISOString();
  const { data, error } = await db.from('messages').select('id,user_id,username,content,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(30);
  if (error) { const p = document.createElement('span'); p.className='help'; p.textContent='Tidak bisa memuat chat. Periksa RLS.'; list.append(p); return; }
  if (!data?.length) { const p=document.createElement('span'); p.className='help'; p.textContent='Belum ada pesan di periode ini.'; list.append(p); return; }
  for (const msg of data) {
    const row = document.createElement('article'); row.className='request-item';
    const title=document.createElement('strong'); title.textContent=`@${msg.username}`;
    const body=document.createElement('small'); body.textContent=`${new Date(msg.created_at).toLocaleString('id-ID')} · ${msg.content}`;
    const actions=document.createElement('div'); actions.className='request-actions'; const del=document.createElement('button'); del.className='btn btn-danger'; del.textContent='Hapus pesan';
    del.addEventListener('click',async()=>{if(!window.confirm('Hapus pesan ini untuk semua anggota?'))return; const {error:delErr}=await db.from('messages').delete().eq('id',msg.id); if(delErr)status(statusBox,`Gagal menghapus: ${delErr.message}`,true);else{status(statusBox,'Pesan berhasil dihapus.');await loadChatMessages();}});
    actions.append(del); row.append(title,body,actions); list.append(row);
  }
}
$('devLogout').addEventListener('click', async()=>{if(db)await db.auth.signOut();devUser=null;dashboard.classList.add('hidden');loginBox.classList.remove('hidden');$('devPassword').value='';});
trySession();
