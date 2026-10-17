/* --------------------------- Part labels (QR) ---------------------------
   Same label as Modcraft prints (jo-labels.js is shared): QR with the scan code, a logo in the QR
   centre, the piece drawn with its banded edges, and a small "developed by RTmo".
   The centre logo defaults to the company the quotation is from (set by Modcraft); here it can be
   changed per job to blank or the client's own logo (pmes_production_jobs.label_logo).
   ------------------------------------------------------------------------ */
function _lblCompanyLogo(company) {
  const c = String(company || '').toLowerCase();
  if (!c) return '';
  if (/cebu/.test(c)) return 'icons/labels/co-cwl.png';
  if (/module/.test(c)) return 'icons/labels/co-mssi.png';
  return 'icons/labels/co-wcl.png';
}
function _lblLogoFor(job) {
  const v = job.label_logo;
  if (v === 'blank') return '';
  if (v && /^data:image\//.test(v)) return v;
  return _lblCompanyLogo((job.mother_jo || {}).company);
}
function _lblModeOf(job) { const v = job.label_logo; return v === 'blank' ? 'blank' : (v && /^data:image\//.test(v) ? 'client' : 'company'); }

function renderLabelsCard(job) {
  const mode = _lblModeOf(job), can = pmesCan('supervisor'), co = (job.mother_jo || {}).company || '';
  const logo = _lblLogoFor(job);
  return `<div class="card"><div class="flex-between" style="gap:8px;flex-wrap:wrap;"><h2 class="mb-0">Part labels</h2>
      <button class="btn primary sm" onclick="printPartLabels('${job.id}')">Print labels</button></div>
    <p class="small" style="margin-top:6px;">One QR label per piece, with the piece drawn and its banded edges marked for the operator.</p>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px;">
      <label class="small">Logo in the QR:</label>
      <select ${can ? '' : 'disabled title="Supervisor or above can change this"'} onchange="setLabelLogoMode('${job.id}',this.value)">
        <option value="company" ${mode === 'company' ? 'selected' : ''}>Company — ${escapeHtml(co || 'from the quotation')}</option>
        <option value="blank" ${mode === 'blank' ? 'selected' : ''}>Blank</option>
        <option value="client" ${mode === 'client' ? 'selected' : ''}>Client's own logo…</option>
      </select>
      ${logo ? `<img src="${escapeHtml(logo)}" alt="" style="height:32px;width:32px;object-fit:contain;border:1px solid var(--border);border-radius:4px;background:#fff">` : '<span class="small">no logo</span>'}
      <input type="file" id="lblLogoFile" accept="image/*" style="display:none" onchange="uploadClientLabelLogo('${job.id}',this)">
    </div></div>`;
}

async function setLabelLogoMode(jobId, mode) {
  if (mode === 'client') { document.getElementById('lblLogoFile').click(); return; }
  try {
    await Data.updateJob(jobId, { label_logo: mode === 'blank' ? 'blank' : null });
    if (State.jd && State.jd.job) State.jd.job.label_logo = mode === 'blank' ? 'blank' : null;
    toast(mode === 'blank' ? 'Labels print with no logo in the QR.' : 'Labels print with the company logo.');
  } catch (e) { toast('Could not save: ' + e.message, 'error'); }
  drawJobTab();
}

// The client's logo is shrunk to 240px on white (small enough to keep in the job row).
function uploadClientLabelLogo(jobId, input) {
  const f = input.files && input.files[0]; if (!f) { drawJobTab(); return; }
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = c.height = 240;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 240, 240);
      const k = Math.min(240 / img.width, 240 / img.height), w = img.width * k, h = img.height * k;
      x.drawImage(img, (240 - w) / 2, (240 - h) / 2, w, h);
      const url = c.toDataURL('image/png');
      try {
        await Data.updateJob(jobId, { label_logo: url });
        if (State.jd && State.jd.job) State.jd.job.label_logo = url;
        toast('Client logo saved for this job’s labels.');
      } catch (e) { toast('Could not save: ' + e.message, 'error'); }
      drawJobTab();
    };
    img.onerror = () => toast('That file is not an image.', 'error');
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
}

function printPartLabels(jobId) {
  const job = (State.jd && State.jd.job && State.jd.job.id === jobId) ? State.jd.job : null;
  const jo = job && job.mother_jo;
  if (!jo || !(jo.parts || []).length) return toast('This job has no Modcraft Job Order, so there are no part labels to print.', 'error');
  const byRef = {}; jo.parts.forEach((p) => { byRef[p.ref] = p; });
  const used = {}, labels = [];
  const label = (p, where) => {
    used[p.ref] = (used[p.ref] || 0) + 1; const k = used[p.ref] - 1;
    const code = (p.barcodes || [])[k] || (p.barcodes || [])[0] || '';
    const scan = (p.scan && (p.scan[k] || p.scan[0])) || code;
    labels.push({ scan, p: p.p, name: p.name, area: p.area, L: p.L, W: p.W, cutL: p.cutL, cutW: p.cutW, th: p.thickness || 0,
      material: [p.material, p.color].filter(Boolean).join(' '), ebt: p.ebt || '', sc: p.sc || 0, lc: p.lc || 0, tape: p.tape || '', where,
      work: (p.services || []).map((x) => x.service + (x.side ? ' — along ' + x.side : '')).join(' · ') });
  };
  (jo.boards || []).forEach((bm) => {
    (bm.layout || []).forEach((lay, bi) => lay.forEach((pc) => { const p = byRef[pc.ref]; if (p) label(p, 'board ' + (bi + 1) + '/' + bm.layout.length); }));
    (bm.oversizedRefs || []).forEach((ref) => { if (byRef[ref]) label(byRef[ref], 'NOT PLACED — too big'); });
  });
  const abs = (rel) => { try { return new URL(rel, location.href).href; } catch (e) { return rel; } };
  const lg = _lblLogoFor(job), logo = lg && !/^data:/.test(lg) ? abs(lg) : lg;
  const payload = JSON.stringify({ labels, logo }).replace(/</g, '\\u003c');
  const w = window.open('', '_blank');
  if (!w) return toast('Pop-up blocked — allow pop-ups to print.', 'error');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Labels ' + escapeHtml(job.job_code) + '</title>'
    + '<style>body{margin:8mm;background:#fff}@media print{.noprint{display:none}}</style></head><body>'
    + '<div class="noprint" style="margin-bottom:8px;font-family:Arial"><button onclick="window.print()">Print</button> ' + escapeHtml(job.job_code) + ' — ' + labels.length + ' labels</div><div id="jl"></div>'
    + '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"><\/script>'
    + '<script src="' + abs('jo-labels.js') + '"><\/script>'
    + '<script>window.addEventListener("load",function(){JoLabels.render(document.getElementById("jl"),' + payload + ');});<\/script></body></html>');
  w.document.close();
}
