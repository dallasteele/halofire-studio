const fs = require('fs');
const path = require('path');
const dir = __dirname;
const md = fs.readFileSync(path.join(dir, 'HALOFIRE_SYSTEM_DESIGN_SPEC.md'), 'utf8');
// JSON-encode, then escape every '<' so the inline <script> can never be broken out of.
const mdJson = JSON.stringify(md).split('<').join('\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HaloFire — System Design &amp; UI/UX Specification</title>
<style>
:root{
  --bg:#0b0d10; --panel2:rgba(14,17,21,0.85);
  --text:#e8ecf2; --muted:#9aa4b2; --faint:#5d6675;
  --line:rgba(255,255,255,0.08); --line-strong:rgba(255,255,255,0.14);
  --gold:#d9a441; --gold-bright:#f0bd5a; --gold-dim:rgba(217,164,65,0.16);
  --info:#5aa9e6; --ok:#54b67a; --r:10px;
}
*{box-sizing:border-box;}
html,body{margin:0;height:100%;}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:14px; line-height:1.62; color:var(--text);
  background:
    radial-gradient(1200px 700px at 70% -10%, rgba(217,164,65,0.06), transparent 60%),
    radial-gradient(900px 600px at 15% 110%, rgba(90,169,230,0.05), transparent 55%),
    var(--bg);
  -webkit-font-smoothing:antialiased;
}
.wrap{display:grid; grid-template-columns:300px 1fr; max-width:1280px; margin:0 auto; min-height:100vh;}
aside{
  position:sticky; top:0; align-self:start; height:100vh; overflow-y:auto;
  padding:22px 16px; border-right:1px solid var(--line);
  background:linear-gradient(180deg, rgba(24,28,34,0.55), rgba(13,16,20,0.35));
  backdrop-filter:blur(14px);
}
aside .brand{font-style:italic; font-weight:700; font-size:16px; margin-bottom:2px;}
aside .brand b{color:var(--gold);}
aside .sub{color:var(--muted); font-size:10.5px; letter-spacing:1.2px; text-transform:uppercase; margin-bottom:16px;}
#toc a{display:block; color:var(--muted); text-decoration:none; padding:3px 8px; border-radius:6px; font-size:12.5px; border-left:2px solid transparent;}
#toc a:hover{color:var(--text); background:rgba(255,255,255,0.04);}
#toc a.h3{padding-left:20px; font-size:12px; color:var(--faint);}
#toc a.active{color:var(--gold-bright); border-left-color:var(--gold); background:var(--gold-dim);}
main{padding:36px 48px 120px; max-width:900px;}
main h1{font-size:30px; line-height:1.2; margin:0 0 6px; letter-spacing:-0.3px;}
main h2{font-size:21px; margin:36px 0 10px; padding-top:14px; border-top:1px solid var(--line);}
main h3{font-size:16px; margin:22px 0 8px; color:var(--gold-bright);}
main h4{font-size:14px; margin:16px 0 6px; color:var(--info);}
main p{margin:9px 0;}
main a{color:var(--info); text-decoration:none;}
main a:hover{text-decoration:underline;}
main code{font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; background:rgba(0,0,0,0.32); padding:1.5px 5px; border-radius:5px; color:var(--gold);}
main pre{background:var(--panel2); border:1px solid var(--line); border-radius:var(--r); padding:14px 16px; overflow-x:auto; box-shadow:0 1px 0 var(--line) inset;}
main pre code{background:none; padding:0; color:var(--muted); font-size:12px; line-height:1.5;}
main ul,main ol{margin:8px 0 8px 4px; padding-left:22px;}
main li{margin:4px 0;}
main blockquote{margin:12px 0; padding:10px 16px; border-left:3px solid var(--gold); background:var(--gold-dim); border-radius:0 8px 8px 0; color:var(--text);}
main hr{border:none; border-top:1px solid var(--line); margin:26px 0;}
main table{border-collapse:collapse; width:100%; margin:12px 0; font-size:12.8px;}
main th,main td{border:1px solid var(--line); padding:7px 10px; text-align:left; vertical-align:top;}
main th{background:rgba(255,255,255,0.04); color:var(--muted); font-weight:600;}
main tr:nth-child(even) td{background:rgba(255,255,255,0.015);}
.tag{display:inline-block; font-size:10px; font-weight:700; letter-spacing:0.4px; padding:1px 6px; border-radius:5px; vertical-align:middle;}
.tag.plat{color:var(--info); background:rgba(90,169,230,0.14); border:1px solid rgba(90,169,230,0.3);}
.tag.vert{color:var(--gold-bright); background:var(--gold-dim); border:1px solid rgba(217,164,65,0.3);}
.tag.patt{color:var(--ok); background:rgba(84,182,122,0.14); border:1px solid rgba(84,182,122,0.3);}
@media(max-width:880px){.wrap{grid-template-columns:1fr;} aside{display:none;} main{padding:24px;}}
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <div class="brand">Halo<b>Fire</b></div>
    <div class="sub">System Design Spec</div>
    <nav id="toc"></nav>
  </aside>
  <main id="content"></main>
</div>
<!-- Canonical source: docs/HALOFIRE_SYSTEM_DESIGN_SPEC.md (regenerate via _gen-spec-html.cjs). AIs: prefer the .md. -->
<script>
const MD = __MD_JSON__;
function inline(s){
  return s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2">$1</a>')
    .replace(/\\[PLATFORM\\]/g,'<span class="tag plat">PLATFORM</span>')
    .replace(/\\[VERTICAL\\]/g,'<span class="tag vert">VERTICAL</span>')
    .replace(/\\[PATTERN\\]/g,'<span class="tag patt">PATTERN</span>');
}
function slug(s){return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');}
function render(md){
  const lines = md.replace(/\\r/g,'').split('\\n');
  let html='', i=0, toc=[], listStack=[];
  function closeList(st){ while(st.length){ html+= st.pop()==='ul'?'</ul>':'</ol>'; } }
  while(i<lines.length){
    let ln=lines[i];
    if(/^\`\`\`/.test(ln)){ closeList(listStack); i++; let buf=''; while(i<lines.length&&!/^\`\`\`/.test(lines[i])){buf+=lines[i]+'\\n';i++;} html+='<pre><code>'+buf.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</code></pre>'; i++; continue; }
    if(/^\\s*\\|/.test(ln)&&/^[\\s|:-]+$/.test(lines[i+1]||'')){
      closeList(listStack);
      const head=ln.split('|').slice(1,-1).map(c=>c.trim());
      i+=2; let rows=[];
      while(i<lines.length&&/^\\s*\\|/.test(lines[i])){ rows.push(lines[i].split('|').slice(1,-1).map(c=>c.trim())); i++; }
      html+='<table><thead><tr>'+head.map(h=>'<th>'+inline(h)+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
      continue;
    }
    let m;
    if(m=ln.match(/^(#{1,4})\\s+(.*)/)){
      closeList(listStack);
      const lvl=m[1].length, txt=m[2], id=slug(txt.replace(/<[^>]+>/g,''));
      html+='<h'+lvl+' id="'+id+'">'+inline(txt)+'</h'+lvl+'>';
      if(lvl===2||lvl===3) toc.push({lvl,txt:txt.replace(/\`/g,''),id});
      i++; continue;
    }
    if(/^---+\\s*$/.test(ln)){ closeList(listStack); html+='<hr>'; i++; continue; }
    if(m=ln.match(/^>\\s?(.*)/)){ closeList(listStack); let buf=[]; while(i<lines.length&&/^>\\s?/.test(lines[i])){buf.push(lines[i].replace(/^>\\s?/,''));i++;} html+='<blockquote>'+inline(buf.join(' '))+'</blockquote>'; continue; }
    if(m=ln.match(/^(\\s*)([-*])\\s+(.*)/)){ if(listStack[listStack.length-1]!=='ul'){closeList(listStack);html+='<ul>';listStack.push('ul');} html+='<li>'+inline(m[3])+'</li>'; i++; continue; }
    if(m=ln.match(/^(\\s*)\\d+\\.\\s+(.*)/)){ if(listStack[listStack.length-1]!=='ol'){closeList(listStack);html+='<ol>';listStack.push('ol');} html+='<li>'+inline(m[2])+'</li>'; i++; continue; }
    if(/^\\s*$/.test(ln)){ closeList(listStack); i++; continue; }
    closeList(listStack); html+='<p>'+inline(ln)+'</p>'; i++;
  }
  closeList(listStack);
  return {html, toc};
}
const out=render(MD);
document.getElementById('content').innerHTML=out.html;
document.getElementById('toc').innerHTML=out.toc.map(t=>'<a class="'+(t.lvl===3?'h3':'')+'" href="#'+t.id+'">'+t.txt.replace(/\\*\\*/g,'')+'</a>').join('');
const links=[].slice.call(document.querySelectorAll('#toc a'));
const map={}; links.forEach(a=>map[a.getAttribute('href').slice(1)]=a);
const obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(l){l.classList.remove('active');});const a=map[e.target.id];if(a)a.classList.add('active');}});},{rootMargin:'-10% 0px -80% 0px'});
document.querySelectorAll('main h2,main h3').forEach(function(h){obs.observe(h);});
</script>
</body>
</html>`;

fs.writeFileSync(path.join(dir, 'halofire-system-design-spec.html'), html.replace('__MD_JSON__', mdJson));
console.log('wrote halofire-system-design-spec.html, md ' + md.length + ' chars');
