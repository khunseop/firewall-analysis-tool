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

function fillForm(initial = {}){
  const root = document.getElementById('modal-device');
  const form = root.querySelector('#device-form');
  const vendorSelect = root.querySelector('#vendor-select');
  vendorSelect.innerHTML = VENDOR_OPTIONS.map(x => `<option value="${x.code}">${x.label}</option>`).join("");
  const set = (name,val)=>{ const el=form.elements.namedItem(name); if(el) el.value = val ?? "" };
  set('name', initial.name);
  set('ip_address', initial.ip_address);
  set('username', initial.username);
  set('description', initial.description);
  vendorSelect.value = normalizeVendorCode(initial.vendor) || VENDOR_OPTIONS[0].code;
  const pw = root.querySelector('#password-input'); if (pw) pw.value = "";
}

function openModal(onSubmit){
  const modal = document.getElementById('modal-device');
  modal.classList.add('is-active');
  const close = () => modal.classList.remove('is-active');
  modal.querySelector('#close-device').onclick = close;
  modal.querySelector('#cancel-device').onclick = (e)=>{e.preventDefault(); close();};
  modal.querySelector('#submit-device').onclick = async (e)=>{
    e.preventDefault();
    const form = modal.querySelector('#device-form');
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.vendor = normalizeVendorCode(payload.vendor);
    if (!payload.password) delete payload.password;
    try { await onSubmit(payload); close(); } catch (err){
      const el = modal.querySelector('#form-error');
      el.textContent = err.message || '요청 실패';
      el.classList.remove('is-hidden');
    }
  };
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
    { headerName:'작업', width: 360, cellRenderer: params => {
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
      fillForm({});
      openModal(async (payload)=>{
        await api.createDevice(payload);
        await reload();
      });
    };
  }
  reload();
}


