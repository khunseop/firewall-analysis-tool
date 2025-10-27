import { api } from "../api.js";

const VENDOR_OPTIONS = [
  { code: "paloalto", label: "Palo Alto" },
  { code: "ngf", label: "SECUI NGF" },
  { code: "mock", label: "Mock" },
];
const codeToLabel = new Map(VENDOR_OPTIONS.map(v => [v.code, v.label]));
const labelToCode = new Map(VENDOR_OPTIONS.map(v => [v.label, v.code]));
let gridOptions;
let gridApi;
let gridHostEl;
let handlersBound = false;

function normalizeVendorCode(value) {
  if (!value) return value;
  const raw = String(value).trim();
  if (codeToLabel.has(raw)) return raw; // already code
  if (labelToCode.has(raw)) return labelToCode.get(raw);
  const compact = raw.toLowerCase().replace(/\s+/g, "");
  for (const { code, label } of VENDOR_OPTIONS) {
    if (compact === code || compact === label.toLowerCase().replace(/\s+/g, "")) return code;
  }
  return raw;
}

function deviceForm(initial = {}) {
  const v = (k, d="") => (initial[k] ?? d);
  const vendorCode = normalizeVendorCode(v("vendor", VENDOR_OPTIONS[0].code));
  return `
  <div class="field">
    <label class="label">이름</label>
    <input class="input" name="name" value="${v("name")}" required />
  </div>
  <div class="field">
    <label class="label">IP 주소</label>
    <input class="input" name="ip_address" value="${v("ip_address")}" required />
  </div>
  <div class="field">
    <label class="label">벤더</label>
    <div class="select is-fullwidth">
      <select name="vendor">
        ${VENDOR_OPTIONS.map(x => `<option value="${x.code}" ${vendorCode===x.code?"selected":""}>${x.label}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="field">
    <label class="label">사용자명</label>
    <input class="input" name="username" value="${v("username")}" required />
  </div>
  <div class="field">
    <label class="label">비밀번호</label>
    <input class="input" type="password" name="password" value="" ${initial.id?"":"required"} />
    <p class="help">수정 시 비워두면 비밀번호는 변경되지 않습니다.</p>
  </div>
  <div class="field">
    <label class="label">설명</label>
    <textarea class="textarea" name="description">${v("description")}</textarea>
  </div>
  `;
}

function openModal(contentHtml, onSubmit) {
  const modal = document.createElement("div");
  modal.className = "modal is-active";
  modal.innerHTML = `
    <div class="modal-background"></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title">장비</p>
        <button class="delete" aria-label="close"></button>
      </header>
      <section class="modal-card-body">
        <form id="device-form">${contentHtml}</form>
        <p class="help is-danger is-hidden" id="form-error"></p>
      </section>
      <footer class="modal-card-foot">
        <button class="button is-primary" id="submit-btn">저장</button>
        <button class="button is-light" id="cancel-btn">취소</button>
      </footer>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector(".delete").onclick = close;
  modal.querySelector("#cancel-btn").onclick = (e)=>{e.preventDefault(); close();};
  modal.querySelector("#submit-btn").onclick = async (e)=>{
    e.preventDefault();
    const fd = new FormData(modal.querySelector("#device-form"));
    const payload = Object.fromEntries(fd.entries());
    payload.vendor = normalizeVendorCode(payload.vendor);
    if (!payload.password) delete payload.password;
    try { await onSubmit(payload); close(); } catch (err){
      const el = modal.querySelector('#form-error');
      el.textContent = err.message || '요청 실패';
      el.classList.remove('is-hidden');
    }
  };
  function close(){ document.body.removeChild(modal); }
}

async function loadGrid(gridDiv, attempt = 0) {
  // agGrid 스크립트 로딩 대기 (보수적으로 재시도)
  if (!window.agGrid || (!window.agGrid.Grid && !window.agGrid.createGrid)) {
    if (attempt < 10) {
      return new Promise(resolve => setTimeout(() => resolve(loadGrid(gridDiv, attempt + 1)), 100));
    }
    console.warn('AG Grid not available. Skipping grid init.');
    return;
  }
  const data = await api.listDevices();
  const needRecreate = !gridApi || !gridHostEl || gridHostEl !== gridDiv;
  if (needRecreate) {
    if (gridApi && typeof gridApi.destroy === 'function') {
      try { gridApi.destroy(); } catch {}
    }
    gridOptions = {
      columnDefs: getColumns(),
      rowData: data,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      rowSelection: 'single',
      animateRows: true,
    };
    if (agGrid.createGrid) {
      gridApi = agGrid.createGrid(gridDiv, gridOptions);
    } else {
      new agGrid.Grid(gridDiv, gridOptions);
      gridApi = gridOptions.api;
    }
    gridHostEl = gridDiv;
  } else {
    if (gridApi) {
      if (typeof gridApi.setGridOption === 'function') gridApi.setGridOption('rowData', data);
      else if (typeof gridApi.setRowData === 'function') gridApi.setRowData(data);
      else if (gridOptions && gridOptions.api) gridOptions.api.setRowData(data);
    } else if (gridOptions && gridOptions.api) {
      gridOptions.api.setRowData(data);
    }
  }
}

function getColumns(){
  return [
    { field: 'id', headerName:'ID', width: 80 },
    { field: 'name', headerName:'이름', flex: 1 },
    { field: 'vendor', headerName:'벤더', width: 140, valueFormatter: p => codeToLabel.get(normalizeVendorCode(p.value)) || p.value },
    { field: 'ip_address', headerName:'IP 주소', width: 160 },
    { field: 'username', headerName:'사용자', width: 140 },
    { field: 'description', headerName:'설명', flex: 1 },
    { field: 'last_sync_status', headerName:'동기화 상태', width: 140 },
    { field: 'last_sync_at', headerName:'동기화 시간', width: 180 },
    { headerName:'작업', width: 280, cellRenderer: params => {
        const d = params.data;
        const wrap = document.createElement('div');
        wrap.className = 'actions';
        wrap.innerHTML = `
          <button class="button is-link" data-act="test">연결테스트</button>
          <button class="button" data-act="edit">수정</button>
          <button class="button is-danger" data-act="del">삭제</button>
          <button class="button is-primary" data-act="sync">동기화</button>
        `;
        wrap.addEventListener('click', async (e)=>{
          const btn = e.target.closest('button');
          const act = btn?.dataset.act;
          if (!act) return;
          btn.setAttribute('disabled', 'disabled');
          const prev = btn.textContent;
          btn.textContent = prev + '…';
          try{
            if (act === 'test') {
              await api.testConnection(d.id);
              alert('연결 성공');
            } else if (act === 'edit') {
              openModal(deviceForm(d), async (payload)=>{
                await api.updateDevice(d.id, payload);
                await reload();
              });
            } else if (act === 'del') {
              if (confirm('삭제하시겠습니까?')){ await api.deleteDevice(d.id); await reload(); }
            } else if (act === 'sync') {
              await api.syncAll(d.id);
              alert('동기화를 시작했습니다.');
            }
          }catch(err){ alert(err.message || '요청 실패'); }
          finally {
            btn.removeAttribute('disabled');
            btn.textContent = prev;
          }
        });
        return wrap;
      }
    },
  ];
}

async function reload(){
  const gridDiv = document.getElementById('devices-grid');
  if (gridDiv) await loadGrid(gridDiv);
}

export function initDevices(root){
  const addBtn = root.querySelector('#btn-add');
  if (addBtn) {
    addBtn.onclick = () => {
      openModal(deviceForm(), async (payload)=>{
        await api.createDevice(payload);
        await reload();
      });
    };
  }
  reload();
}


