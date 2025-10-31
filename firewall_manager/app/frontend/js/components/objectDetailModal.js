// firewall_manager/app/frontend/js/components/objectDetailModal.js

function createModal() {
  const modalHTML = `
    <div id="object-detail-modal" class="modal">
      <div class="modal-background"></div>
      <div class="modal-card">
        <header class="modal-card-head">
          <p class="modal-card-title">객체 상세 정보</p>
          <button class="delete" aria-label="close"></button>
        </header>
        <section class="modal-card-body">
          <div id="object-detail-content"></div>
        </section>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal = document.getElementById('object-detail-modal');
  const background = modal.querySelector('.modal-background');
  const closeButton = modal.querySelector('.delete');

  const closeModal = () => modal.classList.remove('is-active');

  background.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);

  return modal;
}

let modalInstance = null;

function getModal() {
  if (!modalInstance) {
    modalInstance = createModal();
  }
  return modalInstance;
}

function formatObjectDetails(obj) {
  let content = '<table class="table is-bordered is-striped is-narrow is-hoverable is-fullwidth">';

  if (obj.name) content += `<tr><th>이름</th><td>${obj.name}</td></tr>`;
  if (obj.type) content += `<tr><th>타입</th><td>${obj.type}</td></tr>`;
  if (obj.ip_address) content += `<tr><th>IP 주소</th><td>${obj.ip_address}</td></tr>`;
  if (obj.protocol) content += `<tr><th>프로토콜</th><td>${obj.protocol}</td></tr>`;
  if (obj.port) content += `<tr><th>포트</th><td>${obj.port}</td></tr>`;
  if (obj.members) content += `<tr><th>멤버</th><td>${(obj.members || '').replace(/,/g, ',<br>')}</td></tr>`;
  if (obj.description) content += `<tr><th>설명</th><td>${obj.description}</td></tr>`;

  content += '</table>';
  return content;
}

export function showObjectDetailModal(objectData) {
  const modal = getModal();
  const contentElement = modal.querySelector('#object-detail-content');

  contentElement.innerHTML = formatObjectDetails(objectData);

  modal.classList.add('is-active');
}
