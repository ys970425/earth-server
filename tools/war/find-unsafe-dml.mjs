// WHERE 없는 DELETE / UPDATE 찾기 (Supabase의 pg_safeupdate 는 API로 부른 함수 안의 WHERE 없는 DELETE/UPDATE 를 막아요: "DELETE requires a WHERE clause")
// 사용: import { findUnsafeDml } from './find-unsafe-dml.mjs'  /  node tools/war/find-unsafe-dml.mjs  (목록 출력)
import { readFileSync } from 'node:fs';

// 괄호 안(서브쿼리)의 where 는 세지 않아요: update t set a = (select … where …) 는 여전히 WHERE 가 없는 문장이에요
const noParens = t => { let p; do { p = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== p); return t; };

// 주석을 지우고 (줄 번호는 유지), 따옴표 글자는 그대로 두되 $$ 본문 안도 훑어요. 문장은 ; 로 잘라요.
export function findUnsafeDml(sql, file = '') {
  // 주석 제거: 줄 번호를 지키려고 줄바꿈은 남겨요
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  s = s.replace(/--[^\n]*/g, '');
  // 문자열 안의 ; 와 키워드가 문장을 어지럽히지 않게: 'text' 는 모양만 남기고 지우되, execute 로 실행되는 동적 SQL 은 따로 검사해요
  const dynamic = [];
  s = s.replace(/'(?:[^']|'')*'/g, (m, off) => {
    if (/\b(delete\s+from|update\s+[\w."]+\s+set)\b/i.test(m)) dynamic.push({ off, text: m });
    return m.replace(/[^\n]/g, ' ');
  });
  const out = [];
  const lineOf = off => s.slice(0, off).split('\n').length;
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    if (i < s.length && s[i] !== ';') continue;
    const stmt = s.slice(start, i);
    // 한 문장 안에서 delete/update 가 시작되는 모든 자리 (if ... then delete ...; 처럼 앞에 다른 말이 붙을 수 있어요)
    for (const m of stmt.matchAll(/\b(delete\s+from|update)\s+(?!\s*set\b)/gi)) {
      const before = stmt.slice(0, m.index);
      if (/\bdo\s*$/i.test(before) || /on\s+conflict[^;]*\bdo\s*$/i.test(before)) continue;   // on conflict do update set …
      if (/\bfor\s*$/i.test(before) || /\bfor\s+no\s+key\s*$/i.test(before)) continue;        // select … for update
      if (m[1].toLowerCase() === 'update' && /\b(for|no\s+key|share|of)\s*$/i.test(before)) continue;
      const rest = stmt.slice(m.index);
      if (m[1].toLowerCase() === 'update' && !/^\s*update\s+(only\s+)?[\w."]+(\s+(as\s+)?\w+)?\s+set\b/i.test(rest)) continue;
      // 다음 delete/update 가 같은 문장에 또 나오면 거기서 자르고 본다
      const next = rest.slice(m[0].length).search(/\b(delete\s+from|update\s+[\w."]+(\s+(as\s+)?\w+)?\s+set)\b/i);
      const body = next >= 0 ? rest.slice(0, m[0].length + next) : rest;
      if (!/\bwhere\b/i.test(noParens(body))) out.push({ file, line: lineOf(start + m.index), kind: m[1].toLowerCase().startsWith('d') ? 'DELETE' : 'UPDATE', text: rest.replace(/\s+/g, ' ').slice(0, 110) });
    }
    start = i + 1;
  }
  for (const d of dynamic) if (!/\bwhere\b/i.test(d.text)) out.push({ file, line: lineOf(d.off), kind: '동적 SQL', text: d.text.replace(/\s+/g, ' ').slice(0, 110) });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('find-unsafe-dml.mjs')) {
  const all = [];
  for (const f of ['schema.sql', 'config.sql', 'functions.sql'])
    all.push(...findUnsafeDml(readFileSync(new URL(`../../supabase/war/${f}`, import.meta.url), 'utf8'), f));
  for (const x of all) console.log(`${x.file}:${x.line} ${x.kind}  ${x.text}`);
  console.log(all.length ? `WHERE 없는 문장 ${all.length}개` : 'WHERE 없는 DELETE/UPDATE 없음');
  process.exit(all.length ? 1 : 0);
}
