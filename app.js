/* Beam Design App
   Implements the step-by-step calculations from the provided markdown.
   Units: mm, MPa (N/mm^2), kN, kN·m.
*/

(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // ---------- Theme & utility ----------
  const THEME_KEY = 'beamTheme';
  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = $('#btnTheme');
    if (btn) btn.querySelector('.icon').textContent = theme === 'light' ? '☼' : '☾';
  };
  const initTheme = () => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return setTheme(saved);
    const preset = document.documentElement.getAttribute('data-theme');
    if (preset) return setTheme(preset);
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    setTheme(prefersLight ? 'light' : 'dark');
  };

  const fmt = (x, dp=3) => {
    if (!isFinite(x)) return '—';
    const abs = Math.abs(x);
    let d = dp;
    if (abs >= 1000) d = 0;
    else if (abs >= 100) d = 1;
    else if (abs >= 10) d = 2;
    return Number(x).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: Math.min(2, d) });
  };

  const rad = (deg) => deg * Math.PI / 180;

  // ---------- Dynamic layer tables ----------
  function makeRow(kind, idx, values={}){
    const isT = kind === 'tension';
    const tr = document.createElement('tr');
    tr.dataset.kind = kind;
    tr.innerHTML = `
      <td><span class="muted">${idx}</span></td>
      <td><input type="number" step="1" min="6" value="${values.phi ?? (isT?20:16)}" data-field="phi" /></td>
      <td><input type="number" step="1" min="0" value="${values.n ?? (isT?3:0)}" data-field="n" /></td>
      <td><input type="number" step="1" min="0" value="${values.s ?? 25}" data-field="s" /></td>
      <td><button class="rowbtn" type="button" title="Remove">✕</button></td>
    `;
    tr.querySelector('.rowbtn').addEventListener('click', () => {
      tr.remove();
      renumber(kind);
    });
    return tr;
  }

  function renumber(kind){
    const body = kind === 'tension' ? $('#tensionBody') : $('#compressionBody');
    $$('tr', body).forEach((tr, i) => {
      tr.children[0].innerHTML = `<span class="muted">${i+1}</span>`;
    });
  }

  function getLayers(kind){
    const body = kind === 'tension' ? $('#tensionBody') : $('#compressionBody');
    const rows = $$('tr', body);
    return rows.map((tr) => {
      const phi = Number(tr.querySelector('[data-field="phi"]').value);
      const n = Number(tr.querySelector('[data-field="n"]').value);
      const s = Number(tr.querySelector('[data-field="s"]').value);
      return {phi, n, s};
    }).filter(r => r.n > 0 && r.phi > 0);
  }

  function seedTables(){
    const tBody = $('#tensionBody');
    const cBody = $('#compressionBody');
    tBody.appendChild(makeRow('tension', 1, {phi: 20, n: 3, s: 25}));
    tBody.appendChild(makeRow('tension', 2, {phi: 20, n: 3, s: 25}));
    cBody.appendChild(makeRow('compression', 1, {phi: 16, n: 2, s: 25}));
    renumber('tension');
    renumber('compression');
  }

  // ---------- Calculation engine ----------
  function compute(inputs){
    const steps = [];
    const addStep = (section, title, latex, substitution, notes='') => {
      steps.push({section, title, latex, substitution, notes});
    };

    // Unpack inputs
    const fck = inputs.fck; // MPa
    const fyk = inputs.fyk;
    const gamma_c = inputs.gamma_c;
    const gamma_s = inputs.gamma_s;
    const alpha_cc = inputs.alpha_cc;
    const alpha_cc_s = inputs.alpha_cc_s;
    const b = inputs.b; // mm
    const h = inputs.h; // mm
    const ct = inputs.ct; // mm
    const cc = inputs.cc; // mm
    const phi_s = inputs.phi_s; // mm
    const n_l = inputs.n_l;
    const alpha = inputs.alpha; // deg
    const delta = inputs.delta;

    const MEd = inputs.MEd * 1e6; // kN*m to Nmm
    const VEd = inputs.VEd * 1e3; // kN to N
    const NEd = inputs.NEd * 1e3; // kN to N

    const tension = inputs.tension;
    const compression = inputs.compression;

    // ---------- Effective depth (tension) ----------
    const Ai = [];
    const yi = [];
    for (let i=0; i<tension.length; i++){
      let sumPrev = 0;
      for (let k=0; k<i; k++){
        const prev = tension[k];
        sumPrev += (prev.phi + (k < tension.length-1 ? prev.s : 0));
      }
      const y = ct + phi_s + tension[i].phi/2 + sumPrev;
      const A = tension[i].n * (Math.PI * tension[i].phi**2 / 4);
      yi.push(y);
      Ai.push(A);
      addStep('Effective depths', `Tension layer ${i+1}: $y_${i+1}$ and $A_${i+1}$`,
        String.raw`$$y_i = c_t + \varphi_s + \frac{\varphi_{t,i}}{2} + \sum_{k=1}^{i-1}(\varphi_{t,k}+s_{t,k})$$
$$A_i = n_i\,\frac{\pi\,\varphi_{t,i}^2}{4}$$`,
        `y_${i+1} = ${ct} + ${phi_s} + ${tension[i].phi}/2 + ${fmt(sumPrev,2)} = ${fmt(y,2)}\,\text{mm}\nA_${i+1} = ${tension[i].n}\,\pi\,${tension[i].phi}^2/4 = ${fmt(A,2)}\,\text{mm}^2`
      );
    }
    const As_prov = Ai.reduce((a,b)=>a+b,0);
    const ybar_t = As_prov > 0 ? (Ai.reduce((s, A, i)=> s + A*yi[i], 0) / As_prov) : NaN;
    const d = h - ybar_t;
    addStep('Effective depths', 'Centroid of tension steel & effective depth $d$',
      String.raw`$$d = h - \frac{\sum_{i=1}^{m}A_i\,y_i}{\sum_{i=1}^{m}A_i}$$`,
      `\sum A_i = ${fmt(As_prov,2)}\,\text{mm}^2\n\sum A_i y_i = ${fmt(Ai.reduce((s,A,i)=>s+A*yi[i],0),2)}\nd = ${h} - (${fmt(ybar_t,2)}) = ${fmt(d,2)}\,\text{mm}`
    );

    // ---------- Effective depth (compression) ----------
    const Aci = [];
    const yci = [];
    for (let i=0; i<compression.length; i++){
      let sumPrev = 0;
      for (let k=0; k<i; k++){
        const prev = compression[k];
        sumPrev += (prev.phi + (k < compression.length-1 ? prev.s : 0));
      }
      const y = cc + phi_s + compression[i].phi/2 + sumPrev;
      const A = compression[i].n * (Math.PI * compression[i].phi**2 / 4);
      yci.push(y);
      Aci.push(A);
      addStep('Effective depths', `Compression layer ${i+1}: $y_{c,${i+1}}$ and $A_{c,${i+1}}$`,
        String.raw`$$y_{c,i} = c_c + \varphi_s + \frac{\varphi_{c,i}}{2} + \sum_{k=1}^{i-1}(\varphi_{c,k}+s_{c,k})$$
$$A_{c,i} = n_{c,i}\,\frac{\pi\,\varphi_{c,i}^2}{4}$$`,
        `y_{c,${i+1}} = ${cc} + ${phi_s} + ${compression[i].phi}/2 + ${fmt(sumPrev,2)} = ${fmt(y,2)}\,\text{mm}\nA_{c,${i+1}} = ${compression[i].n}\,\pi\,${compression[i].phi}^2/4 = ${fmt(A,2)}\,\text{mm}^2`
      );
    }
    const As2_prov = Aci.reduce((a,b)=>a+b,0);
    const d2 = As2_prov > 0 ? (Aci.reduce((s, A, i)=> s + A*yci[i], 0) / As2_prov) : (cc + phi_s + 8);
    addStep('Effective depths', 'Centroid of compression steel $d_2$',
      String.raw`$$d_2 = \frac{\sum_{i=1}^{n}A_{c,i}\,y_{c,i}}{\sum_{i=1}^{n}A_{c,i}}$$`,
      As2_prov>0 ? `\sum A_{c,i}=${fmt(As2_prov,2)}\,\text{mm}^2\nd_2=${fmt(d2,2)}\,\text{mm}` : `No compression bars entered (or n=0). Using fallback d_2≈${fmt(d2,2)} mm.`
    );

    // ---------- Strain limit eps_cu3 (fixed MathJax cases formatting) ----------
    let eps_cu3;
    if (fck <= 50) eps_cu3 = 0.0035;
    else eps_cu3 = 0.0026 + 0.035*((90 - fck)/100)**4;

    addStep('Materials', 'Concrete strain limit $\\varepsilon_{cu3}$',
      `$$\\varepsilon_{cu3} = 0.0035\\;\\text{for } f_{ck}\\le 50,\\qquad \\varepsilon_{cu3} = 0.0026 + 0.035\\left(\\frac{90-f_{ck}}{100}\\right)^{4}\\;\\text{for } f_{ck}>50$$`,
      `f_{ck}=${fck} → $\\varepsilon_{cu3}$ = ${eps_cu3.toFixed(6)}`
    );

    // ---------- Design strengths ----------
    const fcd = alpha_cc * fck / gamma_c;
    const fyd = fyk / gamma_s;
    const fcd_s = alpha_cc_s * fck / gamma_c;
    addStep('Materials', 'Design material properties',
      String.raw`$$ f_{cd} = \alpha_{cc}\,\frac{f_{ck}}{\gamma_c} $$
$$ f_{yd} = \frac{f_{yk}}{\gamma_s} $$
$$ f_{cd,s} = \alpha_{cc,s}\,\frac{f_{ck}}{\gamma_c} $$`,
      `f_{cd}=${alpha_cc}·${fck}/${gamma_c}=${fmt(fcd,3)} MPa\nf_{yd}=${fyk}/${gamma_s}=${fmt(fyd,3)} MPa\nf_{cd,s}=${alpha_cc_s}·${fck}/${gamma_c}=${fmt(fcd_s,3)} MPa`
    );

    // ---------- Mean strengths ----------
    const fcm = fck + 8;
    let fctm;
    if (fck <= 50) fctm = 0.3 * (fck ** (2/3));
    else fctm = 2.12 * Math.log(1 + fcm/10);

    addStep('Materials', 'Mean strengths',
      String.raw`$$f_{cm}=f_{ck}+8$$
$$f_{ctm}=\begin{cases}0.3f_{ck}^{2/3} & f_{ck}\le 50\\2.12\ln\left(1+\frac{f_{cm}}{10}\right) & f_{ck}>50\end{cases}$$`,
      `f_{cm}=${fck}+8=${fmt(fcm,3)} MPa\nf_{ctm}=${fmt(fctm,3)} MPa`
    );

    // ---------- lambda, eta ----------
    let lambda, eta;
    if (fck <= 50){ lambda = 0.8; eta = 1.0; }
    else {
      lambda = 0.8 - (fck - 50)/400;
      eta = 1.0 - (fck - 50)/200;
    }
    addStep('Compression block', 'Compression block factor $\\lambda$',
      `$$\\lambda = 0.8\\;\\text{for } f_{ck}\\le 50,\\qquad \\lambda = 0.8-\\frac{f_{ck}-50}{400}\\;\\text{for } 50\\le f_{ck}\\le 90,$$`,
      `f_{ck}=${fck} MPa → λ = ${fmt(lambda,4)}`
    );

    addStep('Compression block', 'Compression block factor $\\eta$',
      `$$\\eta = 1.0\\;\\text{for } f_{ck}\\le 50,\\qquad \\eta = 1.0-\\frac{f_{ck}-50}{200}\\;\\text{for } 50\\le f_{ck}\\le 90, $$`,
      `f_{ck}=${fck} MPa → η = ${fmt(eta,4)}`
    );

    // ---------- limiting parameters ----------
    const k2 = 0.6 + 0.0014/eps_cu3;
    addStep('Flexure', 'Limiting moment parameter $k_2$',
      String.raw`$$k_2 = 0.6 + \frac{0.0014}{\varepsilon_{cu3}}$$`,
      `k_2 = 0.6 + 0.0014/${eps_cu3.toFixed(6)} = ${fmt(k2,4)}`
    );

    // ---------- K and K' ----------
    const K = MEd/(fck*b*d*d);
    const Kp = eta*(alpha_cc/gamma_c)*( (lambda*(delta-0.4)/k2) )*(1 - (lambda/2)*(delta-0.4)/k2);
    addStep('Flexure', "Determine $K$ and $K'$", 
      String.raw`$$K=\frac{M_{Ed}}{f_{ck}bd^2}$$
$$K' = \eta\,\frac{\alpha_{cc}}{\gamma_c}\,\left(\lambda\frac{\delta-0.4}{k_2}\right)\left(1-\frac{\lambda}{2}\frac{\delta-0.4}{k_2}\right)$$`,
      `K = ${fmt(MEd,0)}/(${fck}·${b}·${fmt(d,2)}^2) = ${fmt(K,5)}\nK' = ${fmt(Kp,5)}`
    );

    let z, As_req, As2_req = 0, fsc = 0, xu = 0;
    let flexureType;

    if (K <= Kp){
      flexureType = 'Single reinforced';
      const inner = 1 - (3*K)/(eta*alpha_cc);
      if (inner < 0){
        addStep('Flexure', 'Capacity check failed', '', '',
          `The section cannot resist the applied moment with the current inputs (1-3K/(ηα_cc) = ${inner.toFixed(4)} < 0). Increase b/h, reduce MEd, or increase concrete strength.`
        );
        throw new Error('Flexure capacity exceeded (single reinforced).');
      }

      const sqrtTerm = Math.sqrt(inner);
      z = (d/2)*(1 + sqrtTerm);
      z = Math.min(z, 0.95*d);
      As2_req = 0;
      As_req = MEd/(fyd*z);

      addStep('Flexure', 'Single vs double reinforcement',
        String.raw`If $K\le K'$ → single reinforced; else double reinforced.`,
        `K=${fmt(K,5)}; K'=${fmt(Kp,5)} → ${flexureType}`
      );
      addStep('Flexure', 'Lever arm $z$ (single reinforced)',
        String.raw`$$z=\frac{d}{2}\left[1+\sqrt{1-\frac{3K}{\eta\alpha_{cc}}}\right]\le 0.95d$$`,
        `z = ${fmt(z,2)} mm`
      );
      addStep('Flexure', 'Required tension steel $A_s$',
        String.raw`$$A_s=\frac{M_{Ed}}{f_{yd}z}$$`,
        `A_s=${fmt(As_req,2)} mm²`
      );

    } else {
      flexureType = 'Double reinforced';
      const inner = 1 - (3*Kp)/(eta*alpha_cc);
      if (inner < 0){
        addStep('Flexure', 'Capacity check failed', '', '',
          `Double-reinforced lever arm calculation invalid (1-3K'/(ηα_cc) = ${inner.toFixed(4)} < 0). Increase section size or adjust inputs.`
        );
        throw new Error('Flexure capacity exceeded (double reinforced lever arm).');
      }

      const sqrtTerm = Math.sqrt(inner);
      z = (d/2)*(1 + sqrtTerm);
      xu = d*(delta - 0.4)/k2;
      fsc = 700*(xu - d2)/xu;
      fsc = Math.min(fsc, fyd);
      As2_req = ((K - Kp)*fck*b*d*d)/(fsc*(d - d2));
      As_req = (Kp*fck*b*d*d)/(fyd*z) + As2_req*(fsc/fyd);

      addStep('Flexure', 'Single vs double reinforcement',
        String.raw`If $K\le K'$ → single reinforced; else double reinforced.`,
        `K=${fmt(K,5)}; K'=${fmt(Kp,5)} → ${flexureType}`
      );
      addStep('Flexure', "Lever arm $z$ (double reinforced uses $K'$)",
        String.raw`$$z=\frac{d}{2}\left[1+\sqrt{1-\frac{3K'}{\eta\alpha_{cc}}}\right]$$`,
        `z = ${fmt(z,2)} mm`
      );
      addStep('Flexure', 'Neutral axis depth $x_u$',
        String.raw`$$x_u=\frac{d(\delta-0.4)}{k_2}$$`,
        `x_u=${fmt(xu,2)} mm`
      );
      addStep('Flexure', 'Compression steel stress $f_{sc}$',
        String.raw`$$f_{sc}=700\frac{x_u-d_2}{x_u}\le f_{yd}$$`,
        `f_{sc}=${fmt(fsc,3)} MPa`
      );
      addStep('Flexure', 'Required compression steel $A_{s2}$',
        String.raw`$$A_{s2}=\frac{(K-K')f_{ck}bd^2}{f_{sc}(d-d_2)}$$`,
        `A_{s2}=${fmt(As2_req,2)} mm²`
      );
      addStep('Flexure', 'Required tension steel $A_s$',
        String.raw`$$A_s=\frac{K'f_{ck}bd^2}{f_{yd}z} + A_{s2}\frac{f_{sc}}{f_{yd}}$$`,
        `A_s=${fmt(As_req,2)} mm²`
      );
    }

    // ---------- Shear resistance without shear reinforcement ----------
    const bw = b;
    const k = Math.min(2.0, 1 + Math.sqrt(200/d));
    const rho_l = Math.min(0.02, As_prov/(b*d));
    const k1 = 0.15;
    const sigma_cp = NEd/(b*h);
    const CRdc = 0.18/gamma_c;
    const Vmin = 0.035*(k**1.5)*Math.sqrt(fck);

    const Vrdc1 = (CRdc*k*(100*rho_l*fck)**(1/3) + k1*sigma_cp) * bw * d;
    const VrdcMin = (Vmin + k1*sigma_cp) * bw * d;
    const Vrdc = Math.max(Vrdc1, VrdcMin);

    addStep('Shear', 'Shear resistance without shear reinforcement $V_{Rd,c}$',
      String.raw`$$V_{Rd,c} = \left[C_{Rd,c}\,k\,(100\rho_l f_{ck})^{1/3} + k_1\sigma_{cp}\right] b_w d$$
$$V_{Rd,c}\ge \left[V_{min}+k_1\sigma_{cp}\right]b_w d$$`,
      `V_{Rd,c}=${fmt(Vrdc/1e3,2)} kN`
    );

    // ---------- Shear reinforcement ----------
    const alphaRad = rad(alpha);
    const sinAlpha = Math.sin(alphaRad);
    const cotAlpha = 1/Math.tan(alphaRad);
    const z_shear = z;
    const v1 = Math.max(0, 0.6*(1 - fck/250));
    const alpha_cw = 1;

    const Vrdmax = (cotTheta) => alpha_cw*b*z_shear*v1*fcd_s*((cotTheta + cotAlpha)/(1 + cotTheta**2));
    const Vrdmax25 = Vrdmax(2.5);
    const Vrdmax10 = Vrdmax(1.0);

    let cotThetaUsed = 2.5;
    let Asw_s_req = 0;
    let shearCase;
    let shearOK = true;

    const Aswmin_s = 0.08*(Math.sqrt(fck)/fyk)*b*sinAlpha;

    if (VEd <= Vrdc){
      shearCase = 'No shear reinforcement required (provide minimum).';
      Asw_s_req = Aswmin_s;
    } else {
      if (Vrdmax25 >= VEd){
        shearCase = 'Shear reinforcement with cotθ = 2.5';
        cotThetaUsed = 2.5;
        Asw_s_req = VEd/(z_shear*fyd*(2.5 + cotAlpha)*sinAlpha);
      } else if (Vrdmax10 > VEd && VEd > Vrdmax25){
        shearCase = 'Shear reinforcement with variable cotθ';
        const W = VEd/(alpha_cw*b*z_shear*v1*fcd_s);
        const disc = 1 - 4*W*(W - cotAlpha);
        let cot1 = NaN, cot2 = NaN;
        if (disc >= 0){
          cot1 = (1 + Math.sqrt(disc))/(2*W);
          cot2 = (1 - Math.sqrt(disc))/(2*W);
        }
        const cands = [cot1, cot2].filter(c => isFinite(c) && c >= 1.0 && c <= 2.5);
        cotThetaUsed = cands.length ? cands[0] : 1.0;
        Asw_s_req = VEd/(z_shear*fyd*(cotThetaUsed + cotAlpha)*sinAlpha);
        addStep('Shear', 'Determine $\cot\theta$ (when needed)',
          String.raw`$$W=\frac{V_{Ed}}{\alpha_{cw}bzv_1 f_{cd,s}}$$
$$\cot\theta=\frac{1\pm\sqrt{1-4W(W-\cot\alpha)}}{2W}$$`,
          `W=${fmt(W,5)}, \cot\alpha=${fmt(cotAlpha,4)}\nUsing \cot\theta=${fmt(cotThetaUsed,4)}`
        );
      } else {
        shearCase = 'FAIL: VEd exceeds Vrd,max for cotθ=1.0 — increase beam size.';
        shearOK = false;
        Asw_s_req = NaN;
      }
    }

    addStep('Shear', 'Concrete strut capacity $V_{Rd,max}$',
      String.raw`$$V_{Rd,max}=\alpha_{cw}bzv_1 f_{cd,s}\,\frac{(\cot\theta+\cot\alpha)}{(1+(\cot\theta)^2)}$$`,
      `V_{Rd,max}(2.5)=${fmt(Vrdmax25/1e3,2)} kN\nV_{Rd,max}(1.0)=${fmt(Vrdmax10/1e3,2)} kN`
    );

    const Asw_s_final = shearOK ? Math.max(Asw_s_req || 0, Aswmin_s) : NaN;

    addStep('Shear', 'Required shear reinforcement $A_{sw}/s$',
      String.raw`$$\frac{A_{sw}}{s}=\frac{V_{Ed}}{z f_{yd}(\cot\theta+\cot\alpha)\sin\alpha}$$`,
      shearOK ? `Case: ${shearCase}\nA_{sw}/s=${fmt(Asw_s_final,5)} mm²/mm` : `Case: ${shearCase}`
    );

    addStep('Shear', 'Minimum shear reinforcement check',
      String.raw`$$\frac{A_{sw,min}}{s}=0.08\frac{\sqrt{f_{ck}}}{f_{yk}}b\sin\alpha$$`,
      `A_{sw,min}/s=${fmt(Aswmin_s,5)} mm²/mm`
    );

    let deltaAs = 0;
    if (shearOK){
      deltaAs = 0.5*VEd*(cotThetaUsed - cotAlpha)/fyd;
      deltaAs = Math.max(0, deltaAs);
    }

    addStep('Shear', 'Additional tensile reinforcement $\\Delta A_s$',
      String.raw`$$\Delta A_s = \frac{0.5V_{Ed}(\cot\theta-\cot\alpha)}{f_{yd}}$$`,
      shearOK ? `\Delta A_s=${fmt(deltaAs,2)} mm²` : 'Not applicable because shear design failed.'
    );

    // ---------- Min / Max reinforcement ----------
    const As_min = Math.max(0.26*fctm/fyk*b*d, 0.0013*b*d);
    const As_max = 0.04*b*h;

    addStep('Reinforcement limits', 'Minimum tension reinforcement $A_{s,min}$',
      String.raw`$$A_{s,min}=\max\left(\frac{0.26f_{ctm}}{f_{yk}}bd\;\; ;\;\; 0.0013bd\right)$$`,
      `A_{s,min}=${fmt(As_min,2)} mm²`
    );

    addStep('Reinforcement limits', 'Maximum reinforcement $A_{s,max}$',
      String.raw`$$A_{s,max}=0.04bh$$`,
      `A_{s,max}=${fmt(As_max,2)} mm²`
    );

    // ---------- Shear spacing limits ----------
    const s_l_max = 0.75*d*(1 + cotAlpha);
    const s_t_max = Math.min(0.75*d, 600);

    addStep('Shear spacing', 'Maximum shear tie spacing',
      String.raw`$$s_{l,max}=0.75d(1+\cot\alpha)$$
$$s_{t,max}=0.75d\le 600\,\text{mm}$$`,
      `s_{l,max}=${fmt(s_l_max,0)} mm\ns_{t,max}=${fmt(s_t_max,0)} mm`
    );

    // Provided reinforcement checks
    const As_total_req = As_req + deltaAs;

    addStep('Provided reinforcement', 'Area of reinforcement provided',
      String.raw`$$A_{sp}=\sum_{i=1}^{m}A_i\qquad A_{sp2}=\sum_{i=1}^{n}A_{c,i}$$`,
      `A_{sp}=${fmt(As_prov,2)} mm² (tension)\nA_{sp2}=${fmt(As2_prov,2)} mm² (compression)\nRequired tension (incl. ΔAs)=${fmt(As_total_req,2)} mm²\nRequired compression As2=${fmt(As2_req,2)} mm²`
    );

    const flexureCheck = (() => {
      if (As_prov >= 1.1*As_total_req) return {level:'warn', text:'Provided tension steel is significantly higher than required.'};
      if (As_prov >= As_total_req) return {level:'ok', text:'Provided tension steel is sufficient.'};
      return {level:'danger', text:'Provided tension steel is NOT sufficient — increase tension reinforcement.'};
    })();

    const compCheck = (() => {
      if (As2_req <= 1e-6) return {level:'ok', text:'Compression steel not required (single-reinforced).'};
      if (As2_prov >= 1.1*As2_req) return {level:'warn', text:'Provided compression steel is significantly higher than required.'};
      if (As2_prov >= As2_req) return {level:'ok', text:'Provided compression steel is sufficient.'};
      return {level:'danger', text:'Provided compression steel is NOT sufficient — increase compression reinforcement.'};
    })();

    const minOk = As_total_req >= As_min;
    const maxOkT = As_total_req < As_max;
    const maxOkC = As2_req < As_max;

    // Tie estimate (account spacing limits)
    const Asw_per_stirrup = n_l * (Math.PI*phi_s**2/4);

    // Minimum stirrups per metre from required Asw/s
    const nReqByAsw = shearOK ? Math.ceil((Asw_s_final*1000) / Asw_per_stirrup) : 0;

    // Minimum stirrups per metre to satisfy longitudinal spacing limit s_l,max
    const nReqBySlMax = shearOK ? Math.ceil(1000 / s_l_max) : 0;

    // Adopt governing requirement
    const nStirrupsPerM = shearOK ? Math.max(1, nReqByAsw, nReqBySlMax) : 0;

    // Adopt spacing not exceeding s_l,max
    const s_l = shearOK && nStirrupsPerM>0 ? Math.floor(1000 / nStirrupsPerM) : NaN;

    // Across-width spacing check. If it exceeds s_t,max, report minimum legs required.
    const coverSide = Math.max(ct, cc);
    const clearWidth = (b - 2*coverSide - phi_s);
    const s_t = (n_l>1) ? clearWidth / (n_l-1) : NaN;
    const nLegsReqByStMax = (isFinite(clearWidth) && clearWidth>0) ? (Math.ceil(clearWidth / s_t_max) + 1) : NaN;

    const spacingOK = shearOK ? (s_l <= s_l_max && s_t <= s_t_max) : false;

    addStep('Shear detailing', 'Tie count and spacing estimate (with limits)',
      String.raw`Tie steel per stirrup: $A_{sw,st} = n_l\,\pi\varphi_s^2/4$.

Number per metre from steel demand: $n_{Asw}=\lceil (A_{sw}/s)\cdot 1000 / A_{sw,st} \rceil$.

Number per metre from spacing limit: $n_{sl}=\lceil 1000/s_{l,max} \rceil$.

Adopt: $n=\max(n_{Asw}, n_{sl})$ and $s_l=\lfloor 1000/n \rfloor \le s_{l,max}$.`,
      shearOK ? `A_{sw,st}=${fmt(Asw_per_stirrup,2)} mm²
(A_{sw}/s)=${fmt(Asw_s_final,5)} mm²/mm → n_Asw=${nReqByAsw}/m
s_l,max=${fmt(s_l_max,0)} mm → n_sl=${nReqBySlMax}/m
Adopt n=${nStirrupsPerM}/m → s_l≈${fmt(s_l,0)} mm
Across width: s_t≈${fmt(s_t,0)} mm (limit ${fmt(s_t_max,0)} mm)
Min legs to satisfy s_t,max: n_l,min≈${isFinite(nLegsReqByStMax)?nLegsReqByStMax:'—'}`
             : 'Not applicable because shear design failed.'
    );

    return {
      inputs,
      flexure: {type:flexureType, d, d2, z, As_req, As2_req, K, Kp},
      shear: {
        Vrdc, Vrdmax25, Vrdmax10,
        shearCase,
        cotTheta: cotThetaUsed,
        Asw_s: Asw_s_final,
        Asw_s_min: Aswmin_s,
        deltaAs,
        shearOK,
        s_l, s_l_max,
        s_t, s_t_max,
        spacingOK,
        nStirrupsPerM
      },
      limits: { As_min, As_max, minOk, maxOkT, maxOkC },
      provided: { As_prov, As2_prov, As_total_req, flexureCheck, compCheck },
      steps
    };
  }

  // ---------- Rendering ----------
  function badge(level, text){
    const cls = level === 'ok' ? 'badge--ok' : level === 'warn' ? 'badge--warn' : 'badge--danger';
    return `<span class="badge ${cls}"><span class="badge__dot"></span><span>${escapeHtml(text)}</span></span>`;
  }

  function renderSummary(r){
    const sum = $('#summary');

    const shearOkBadge = r.shear.shearOK ? badge('ok', 'Shear OK') : badge('danger', 'Shear FAIL');
    const spacingBadge = r.shear.shearOK ? (r.shear.spacingOK ? badge('ok', 'Spacing OK') : badge('warn', 'Spacing check')) : badge('danger', 'No spacing');

    const minBadge = r.limits.minOk ? badge('ok', 'As ≥ As,min') : badge('danger', 'As < As,min');
    const maxBadgeT = r.limits.maxOkT ? badge('ok', 'As < As,max') : badge('danger', 'As ≥ As,max');
    const maxBadgeC = r.limits.maxOkC ? badge('ok', 'As2 < As,max') : badge('danger', 'As2 ≥ As,max');

    sum.innerHTML = `
      <div class="kpiGrid">
        <div class="kpi">
          <div class="kpi__label">Section type</div>
          <div class="kpi__value">${r.flexure.type}</div>
          <div class="kpi__sub">d = <b>${fmt(r.flexure.d,2)} mm</b>, z = <b>${fmt(r.flexure.z,2)} mm</b></div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Design actions</div>
          <div class="kpi__value">MEd ${fmt(r.inputs.MEd,2)} kN·m</div>
          <div class="kpi__sub">VEd ${fmt(r.inputs.VEd,2)} kN, NEd ${fmt(r.inputs.NEd,2)} kN</div>
        </div>

        <div class="kpi">
          <div class="kpi__label">Tension steel required</div>
          <div class="kpi__value">As = ${fmt(r.flexure.As_req,2)} mm²</div>
          <div class="kpi__sub">ΔAs = ${fmt(r.shear.deltaAs,2)} mm² → Total = <b>${fmt(r.provided.As_total_req,2)} mm²</b></div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Compression steel required</div>
          <div class="kpi__value">As2 = ${fmt(r.flexure.As2_req,2)} mm²</div>
          <div class="kpi__sub">Provided = ${fmt(r.provided.As2_prov,2)} mm²</div>
        </div>

        <div class="kpi">
          <div class="kpi__label">Shear capacity</div>
          <div class="kpi__value">Vrd,c = ${fmt(r.shear.Vrdc/1e3,2)} kN</div>
          <div class="kpi__sub">${r.shear.shearCase}</div>
        </div>
        <div class="kpi">
          <div class="kpi__label">Shear reinforcement</div>
          <div class="kpi__value">Asw/s = ${fmt(r.shear.Asw_s,5)} mm²/mm</div>
          <div class="kpi__sub">~ ${fmt(r.shear.nStirrupsPerM,0)}/m ⇒ s ≈ <b>${fmt(r.shear.s_l,0)} mm</b></div>
        </div>
      </div>

      <div style="display:grid; gap:10px; margin-top: 10px;">
        ${badge(r.provided.flexureCheck.level, r.provided.flexureCheck.text)}
        ${badge(r.provided.compCheck.level, r.provided.compCheck.text)}
        ${shearOkBadge}
        ${spacingBadge}
        ${minBadge}
        ${maxBadgeT}
        ${maxBadgeC}
      </div>

      <div class="muted small" style="margin-top:10px;">Provided tension steel: ${fmt(r.provided.As_prov,2)} mm². Spacing limits: s_l,max=${fmt(r.shear.s_l_max,0)} mm, s_t,max=${fmt(r.shear.s_t_max,0)} mm.</div>
    `;

    typesetMath(sum);
  }

  function renderDetails(r){
    const details = $('#details');

    const sections = {};
    for (const s of r.steps){
      if (!sections[s.section]) sections[s.section] = [];
      sections[s.section].push(s);
    }

    details.innerHTML = Object.entries(sections).map(([section, arr]) => {
      const items = arr.map((st) => {
        const formula = st.latex ? `<div class="eq">${st.latex}</div>` : '';
        const subs = (() => {
          if (!st.substitution) return '';
          const sub = String(st.substitution);
          const isMath = /^\s*(\$\$|\\\[)/.test(sub);
          if (isMath) return `<div class="eq">${sub}</div>`;
          return `<div class="eq"><strong>Substitution:</strong><br/>${escapeHtml(sub).replace(/\n/g,'<br/>')}</div>`;
        })();
        const notes = st.notes ? `<div class="eq"><strong>Note:</strong> ${escapeHtml(st.notes)}</div>` : '';

        return `
          <div class="calcItem">
            <div class="calcItem__head">${escapeHtml(st.title)}</div>
            <div class="calcItem__body">
              ${formula}
              ${subs}
              ${notes}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div>
          <div class="calcSectionTitle">${escapeHtml(section)}</div>
          <div style="display:grid; gap:10px;">${items}</div>
        </div>
      `;
    }).join('');

    typesetMath(details);
  }

  function escapeHtml(str){
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function typesetMath(root){
    if (window.MathJax && window.MathJax.typesetPromise){
      window.MathJax.typesetPromise([root]).catch(()=>{});
    }
  }

  // ---------- Form extraction & validation ----------
  function getInputs(){
    const f = $('#beamForm');
    const get = (name) => Number(f.elements[name].value);

    return {
      fck: get('fck'),
      fyk: get('fyk'),
      gamma_c: get('gamma_c'),
      gamma_s: get('gamma_s'),
      alpha_cc: get('alpha_cc'),
      alpha_cc_s: get('alpha_cc_s'),
      b: get('b'),
      h: get('h'),
      ct: get('ct'),
      cc: get('cc'),
      phi_s: get('phi_s'),
      n_l: get('n_l'),
      alpha: get('alpha'),
      delta: get('delta'),
      MEd: get('MEd'),
      VEd: get('VEd'),
      NEd: get('NEd'),
      tension: getLayers('tension'),
      compression: getLayers('compression'),
    };
  }

  function validateInputs(inp){
    const errors = [];
    if (!inp.tension.length) errors.push('Enter at least one tension reinforcement layer with n>0.');
    if (inp.b <= 0 || inp.h <= 0) errors.push('b and h must be positive.');
    if (inp.delta < 0.70 || inp.delta > 1.00) errors.push('Redistribution δ must be between 0.70 and 1.00.');
    if (inp.ct + inp.cc > inp.h) errors.push('Covers look too large compared to h.');
    if (inp.alpha <= 0 || inp.alpha > 90) errors.push('Angle α should be between 1 and 90 degrees.');
    return errors;
  }

  // ---------- Wire up events ----------
  function init(){
    initTheme();
    seedTables();

    $('#btnTheme').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      setTheme(current === 'light' ? 'dark' : 'light');
    });

    $('#btnPrint').addEventListener('click', () => window.print());

    $('#btnReset').addEventListener('click', () => {
      $('#beamForm').reset();
      $('#tensionBody').innerHTML = '';
      $('#compressionBody').innerHTML = '';
      seedTables();
      $('#summary').innerHTML = `
        <div class="empty">
          <div class="empty__icon">📐</div>
          <div class="empty__text">
            <div class="empty__title">No results yet</div>
            <div class="muted">Fill inputs and click <b>Calculate</b>.</div>
          </div>
        </div>
      `;
      $('#details').innerHTML = '';
      $('#status').textContent = 'Reset to defaults.';
      setTimeout(()=>$('#status').textContent='', 2000);
    });

    $('#addTensionRow').addEventListener('click', () => {
      const body = $('#tensionBody');
      body.appendChild(makeRow('tension', body.children.length+1, {phi: 16, n: 2, s: 25}));
      renumber('tension');
    });

    $('#addCompressionRow').addEventListener('click', () => {
      const body = $('#compressionBody');
      body.appendChild(makeRow('compression', body.children.length+1, {phi: 16, n: 2, s: 25}));
      renumber('compression');
    });

    $('#beamForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = getInputs();
      const errors = validateInputs(inp);
      const status = $('#status');

      if (errors.length){
        status.textContent = errors.join(' ');
        status.style.color = 'var(--danger)';
        return;
      }
      status.textContent = 'Calculating…';
      status.style.color = 'var(--muted)';

      try{
        const results = compute(inp);
        renderSummary(results);
        renderDetails(results);

        status.textContent = 'Done.';
        status.style.color = 'var(--ok)';
        setTimeout(()=>{status.textContent=''; status.style.color='var(--muted)';}, 2500);
      }catch(err){
        console.error(err);
        status.textContent = 'Calculation error — please check inputs.';
        status.style.color = 'var(--danger)';
      }
    });

    typesetMath(document.body);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
