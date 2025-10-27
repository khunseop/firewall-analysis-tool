import { api } from "../api.js";

const VENDORS = ["Palo Alto", "SECUI NGF", "Mock"]; // mf2 제외
let gridOptions;

function deviceForm(initial = {}) {
  const v = (k, d="") => (initial[k] ?? d);
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
        ${VENDORS.map(x => `<option ${v("vendor")===x?"selected":""}>${x}</option>`).join("")}
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
    if (!payload.password) delete payload.password;
    try { await onSubmit(payload); close(); } catch (err){
      const el = modal.querySelector('#form-error');
      el.textContent = err.message || '요청 실패';
      el.classList.remove('is-hidden');
    }
  };
  function close(){ document.body.removeChild(modal); }
}

async function loadGrid(gridDiv) {
  const data = await api.listDevices();
  if (!gridOptions) {
    gridOptions = {
      columnDefs: getColumns(),
      rowData: data,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      rowSelection: 'single',
      animateRows: true,
    };
    new agGrid.Grid(gridDiv, gridOptions);
  } else {
    gridOptions.api.setRowData(data);
  }
}

function getColumns(){
  return [
    { field: 'id', headerName:'ID', width: 80 },
    { field: 'name', headerName:'이름', flex: 1 },
    { field: 'vendor', headerName:'벤더', width: 140 },
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
          const act = e.target.closest('button')?.dataset.act;
          if (!act) return;
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

export function DevicesPage(){
  // 렌더 이후 초기화
  setTimeout(async ()=>{
    await reload();
    const addBtn = document.getElementById('btn-add');
    if (addBtn) {
      addBtn.onclick = () => {
        openModal(deviceForm(), async (payload)=>{
          await api.createDevice(payload);
          await reload();
        });
      };
    }
  }, 0);
  return `
    <div class="page-title">장비관리</div>
    <div class="actions">
      <button class="button is-primary" id="btn-add">장비 추가</button>
    </div>
    <div id="devices-grid" class="ag-theme-quartz"></div>
  `;
}


