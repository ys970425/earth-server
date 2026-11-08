// Browser preview runs the unmodified server SQL in a fresh, in-memory database.
const params = new URLSearchParams(location.search);
let ready;
function cleanError(e) {
  const msg = (e && (e.message || e.details || e.hint)) || String(e);
  const match = msg.match(/^[A-Z_]+:\s*(.*)$/s);
  const err = new Error(match ? match[1] : msg);
  err.code = (msg.match(/^([A-Z_]+):/) || [])[1] || 'ERROR';
  return err;
}
async function open() {
  const suffix = params.get('preview') === 'real' ? '-real' : '';
  const command = suffix ? 'war:preview:real' : 'war:preview';
  const missing = () => new Error(`터미널에서 npm run ${command} 를 먼저 실행해 주세요`);
  const [archive, metadata] = await Promise.all(['tar.gz', 'json'].map(async ext => {
    let response;
    try { response = await fetch(new URL(`../preview/db${suffix}.${ext}`, import.meta.url)); }
    catch { throw missing(); }
    if (!response.ok) throw missing();
    try { return ext === 'json' ? await response.json() : await response.blob(); }
    catch { throw missing(); }
  }));
  const { PGlite } = await import('https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.15/dist/index.js');
  const db = new PGlite({ loadDataDir: archive });
  await db.waitReady;
  let uid = metadata.admin_uid;
  // 관제실은 admin.html과 index.html?admin=1 두 주소 모두에서 교사 uid로 열린다 (관제실 주소 통일)
  if (!location.pathname.endsWith('/admin.html') && params.get('admin') !== '1') {
    const [countryText, role] = (params.get('as') || '1').split(':');
    const country = Number(countryText || 1);
    const students = metadata.students.filter(s => s.country === country);
    if (!students.length) throw new Error('이 나라의 미리보기 학생이 없어요.');
    if (params.get('size') === '4') {
      for (const student of students.slice(4)) {
        await db.query('delete from war.roles where student = $1', [student.id]);
        await db.query('delete from priv.students where id = $1', [student.id]);
      }
    }
    const student = students[0];
    uid = student.uid;
    await db.query('delete from war.roles where student = $1', [student.id]);
    if (role) {
      await db.query('delete from war.roles where country = $1 and role = $2', [country, role]);
      await db.query('insert into war.roles(student, country, role) values ($1, $2, $3)', [student.id, country, role]);
    }
  }
  await db.query("select set_config('request.uid', $1, false)", [uid]);
  return db;
}
export async function rpc(name, args = {}) {
  try {
    if (!/^war_[a-z_]+$/.test(name)) throw new Error('BAD_FN: 없는 함수예요.');
    const entries = Object.entries(args);
    if (entries.some(([key]) => !/^p_[a-z_]+$/.test(key))) throw new Error('BAD_ARGS: 잘못된 인자예요.');
    const db = await (ready ||= open());
    const named = entries.map(([key], i) => `${key} => $${i + 1}`).join(', ');
    const values = entries.map(([, value]) => value !== null && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value);
    return (await db.query(`select public.${name}(${named}) as r`, values)).rows[0].r;
  } catch (e) { throw cleanError(e); }
}
