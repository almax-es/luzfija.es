document.addEventListener('DOMContentLoaded', async ()=>{
      initTooltips();
      applyThemeClass(document.documentElement.classList.contains('light-mode')?'light':'dark');
      updateThemeIcon();
      loadInputs();

      initialStatusText = el.statusText?.textContent || '';
      initialStatusClass = el.statusPill?.className || '';

      validateInputs();
      markPending('Introduce tus datos y pulsa Calcular para ver el ranking.');

      Object.values(el.inputs).forEach(i=>{
        i.addEventListener('input',()=>{
          updateKwhHint();
          scheduleCalculateDebounced();
        });
      });

      if(el.inputs.zonaFiscal){
        el.inputs.zonaFiscal.addEventListener('change',()=>{
          updateZonaFiscalUI();
          scheduleCalculateDebounced();
        });
      }
      if(el.inputs.viviendaCanarias){
        el.inputs.viviendaCanarias.addEventListener('change',()=>{
          scheduleCalculateDebounced();
        });
      }

      if(el.btnTheme){
        el.btnTheme.addEventListener('click',(e)=>{
          createRipple(el.btnTheme,e);
          toggleTheme();
        });
      }

      document.querySelectorAll('.fbtn').forEach(b=>{
        b.addEventListener('click',(e)=>{
          createRipple(b,e);
          document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active'));
          b.classList.add('active');
          state.filter=b.getAttribute('data-filter');
          renderTable();
        });
      });

      document.querySelectorAll('thead th.sort').forEach(th=>{
        th.addEventListener('click',()=>{
          const k=th.getAttribute('data-sort');
          if(!k)return;
          if(state.sort.key===k)state.sort.dir=(state.sort.dir==='asc')?'desc':'asc';
          else{state.sort.key=k;state.sort.dir='asc';}
          renderTable();updateSortIcons();
        });
      });

      el.btnCalc.addEventListener('click',(e)=>{
        createRipple(el.btnCalc,e);
        runCalculation(false);
      });

      // Enter en cualquier input → Calcular
      Object.values(el.inputs).forEach(input => {
        input.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            createRipple(el.btnCalc, { clientX: el.btnCalc.offsetLeft + el.btnCalc.offsetWidth/2, clientY: el.btnCalc.offsetTop + el.btnCalc.offsetHeight/2 });
            runCalculation(true);
          }
        });
      });

      el.btnMenu.addEventListener('click',(e)=>{
        createRipple(el.btnMenu,e);
        e.stopPropagation();
        toggleMenu();
      });

      el.menuPanel.addEventListener('click',(e)=>e.stopPropagation());
      document.addEventListener('click',()=>toggleMenu(false));
      document.addEventListener('keydown',(e)=>{if(e.key==='Escape')toggleMenu(false);});

      el.btnReset.addEventListener('click',(e)=>{
        createRipple(el.btnReset,e);
        toggleMenu(false);
        window.location.href = window.location.pathname + '?reset=1';
      });

      el.btnExport.addEventListener('click',(e)=>{
        createRipple(el.btnExport,e);
        toggleMenu(false);
        if(!state.rows || state.rows.length === 0){ toast('No hay datos para descargar','err'); return; }
        const headers = ['#','Tarifa','Potencia','Consumo','Impuestos','Total','Vs Mejor','Tipo','Web'];
        const rows = state.rows.map(r=>[r.posicion,r.nombre,r.potencia,r.consumo,r.impuestos,r.total,r.vsMejor,r.tipo,r.webUrl||'']);
        const csv = [headers, ...rows].map(r=>r.join(';')).join('\n');
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], {type:'text/csv;charset=utf-8;'});
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href',url);
        link.setAttribute('download',`ranking_tarifas_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility='hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast('Ranking descargado');
      });

      el.btnShare.addEventListener('click', async (e) => {
        createRipple(el.btnShare,e);
        toggleMenu(false);

        const d = saveInputs();
        const qp = new URLSearchParams(d).toString();
        const url = `${window.location.origin}${window.location.pathname}?${qp}`;
        await copyText(url);
        toast('Enlace copiado al portapapeles');
      });

      if (typeof window.__LF_bindFacturaParser === 'function') {
        window.__LF_bindFacturaParser();
      }

      $('scrollToResults').addEventListener('click',()=>$('heroKpis').scrollIntoView({behavior:'smooth',block:'start'}));
    });
  