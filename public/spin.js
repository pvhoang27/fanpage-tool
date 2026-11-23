/* Bo "xao" tin nhan — dung chung cho server (require) va trinh duyet (window.Spin).
 *
 * Cu phap:  {Chào|Dạ chào|Hi} {{first_name}} {ạ|nha|}
 *   - {a|b|c}  -> chon ngau nhien 1 trong cac lua chon (de trong = bo qua)
 *   - long nhau duoc: {Shop {vừa|mới} về hàng|Có mẫu mới}
 *   - {{name}} / {{first_name}} giu nguyen, de dien ten khach sau
 *   - ngoac mo ma khong dong thi giu nguyen nhu chu thuong
 */
(function (root) {
  'use strict';

  // Tam giau {{...}} de khong bi hieu nham la lua chon
  const VAR_RE = /\{\{\s*[a-z_]+\s*\}\}/gi;

  function hideVars(text) {
    const vars = [];
    const s = String(text ?? '').replace(VAR_RE, (m) => {
      vars.push(m);
      return `\u0001${vars.length - 1}\u0002`;
    });
    return { s, vars };
  }

  function showVars(s, vars) {
    return s.replace(/\u0001(\d+)\u0002/g, (_, i) => vars[Number(i)]);
  }

  /**
   * Phan tich thanh cay: Seq = mang cac phan tu, moi phan tu la chuoi
   * hoac { options: Seq[] }.
   */
  function parse(s) {
    let i = 0;

    function seq(inGroup) {
      const parts = [];
      let buf = '';
      while (i < s.length) {
        const c = s[i];
        if (inGroup && (c === '|' || c === '}')) break;
        if (c === '{') {
          const start = i;
          i++;
          const options = [seq(true)];
          while (s[i] === '|') { i++; options.push(seq(true)); }
          if (s[i] === '}') {
            i++;
            if (buf) { parts.push(buf); buf = ''; }
            parts.push({ options });
          } else {
            // khong dong ngoac -> coi nhu chu thuong
            buf += s.slice(start, i);
          }
          continue;
        }
        buf += c;
        i++;
      }
      if (buf) parts.push(buf);
      return parts;
    }

    return seq(false);
  }

  function render(parts, rnd) {
    return parts
      .map((p) => (typeof p === 'string' ? p : render(p.options[Math.floor(rnd() * p.options.length)], rnd)))
      .join('');
  }

  function count(parts) {
    let n = 1;
    for (const p of parts) {
      if (typeof p === 'string') continue;
      n *= p.options.reduce((sum, o) => sum + count(o), 0);
      if (n > 1e9) return Infinity;
    }
    return n;
  }

  /** Don dep khoang trang thua do lua chon rong de lai: "Chào  bạn ." -> "Chào bạn." */
  function tidy(s) {
    return s
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.!?…])/g, '$1')
      .replace(/^[ \t]+|[ \t]+$/gm, '');
  }

  /** Xao 1 lan, tra ve 1 cau (con nguyen {{name}} de dien ten sau) */
  function spin(text, rnd = Math.random) {
    const { s, vars } = hideVars(text);
    return showVars(tidy(render(parse(s), rnd)), vars);
  }

  /** So kieu cau khac nhau co the xao ra */
  function variants(text) {
    return count(parse(hideVars(text).s));
  }

  /** Co dung cu phap xao khong */
  function hasSpin(text) {
    return variants(text) > 1;
  }

  const api = { spin, variants, hasSpin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Spin = api;
})(typeof window !== 'undefined' ? window : globalThis);
