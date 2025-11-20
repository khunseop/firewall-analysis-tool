/**
 * 모달 열기 (공통 로직)
 * @param {HTMLElement} modal - 모달 요소
 * @param {Function} onClose - 닫기 콜백
 */
function setupModalCloseHandlers(modal, onClose) {
  if (!modal) return;

  const handleEsc = (e) => {
    if (e.key === 'Escape') onClose();
  };

  document.addEventListener('keydown', handleEsc);

  const background = modal.querySelector('.modal-background');
  if (background) {
    background.onclick = onClose;
  }

  return () => {
    document.removeEventListener('keydown', handleEsc);
  };
}

/**
 * 확인 모달 동적 생성 (백업용)
 * @param {string} modalId - 모달 ID (기본값: 'modal-confirm')
 * @returns {HTMLElement} 생성된 모달 요소
 */
function createConfirmModal(modalId = 'modal-confirm') {
  const modal = document.createElement('div');
  modal.className = 'modal is-compact';
  modal.id = modalId;
  modal.innerHTML = `
    <div class="modal-background"></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title" id="confirm-title">확인</p>
        <button class="delete" aria-label="close" id="confirm-close"></button>
      </header>
      <section class="modal-card-body">
        <p id="confirm-message">이 작업을 진행하시겠습니까?</p>
      </section>
      <footer class="modal-card-foot is-justify-content-flex-end">
        <button class="button is-light is-small" id="confirm-cancel">취소</button>
        <button class="button is-primary is-small" id="confirm-ok">확인</button>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/**
 * 확인 모달 열기
 * @param {Object} options - 옵션
 * @param {string} options.title - 제목 (기본값: '확인')
 * @param {string} options.message - 메시지 (기본값: '이 작업을 진행하시겠습니까?')
 * @param {string} options.okText - 확인 버튼 텍스트 (기본값: '확인')
 * @param {string} options.cancelText - 취소 버튼 텍스트 (기본값: '취소')
 * @param {string} options.modalId - 모달 ID (기본값: 'modal-confirm')
 * @returns {Promise<boolean>} 확인 여부
 */
export function openConfirm({ 
  title = '확인', 
  message = '이 작업을 진행하시겠습니까?', 
  okText = '확인', 
  cancelText = '취소',
  modalId = 'modal-confirm'
} = {}) {
  return new Promise(resolve => {
    let modal = document.getElementById(modalId);
    
    // 모달이 없으면 동적으로 생성 (백업용)
    if (!modal) {
      console.warn(`${modalId} 요소를 찾을 수 없어 동적으로 생성합니다`);
      modal = createConfirmModal(modalId);
    }

    modal.classList.add('is-active');
    const $ = (sel) => modal.querySelector(sel);
    
    $('#confirm-title').textContent = title;
    $('#confirm-message').textContent = message;
    $('#confirm-ok').textContent = okText;
    $('#confirm-cancel').textContent = cancelText;
    
    let cleanup = null;
    
    const close = (val) => {
      modal.classList.remove('is-active');
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      resolve(val);
    };
    
    const handleEsc = (e) => {
      if (e.key === 'Escape') close(false);
    };
    
    document.addEventListener('keydown', handleEsc);
    
    // 배경 클릭 핸들러
    const background = modal.querySelector('.modal-background');
    if (background) {
      background.onclick = () => close(false);
    }
    
    cleanup = () => {
      document.removeEventListener('keydown', handleEsc);
      if (background) {
        background.onclick = null;
      }
    };
    
    $('#confirm-close').onclick = () => close(false);
    $('#confirm-cancel').onclick = () => close(false);
    $('#confirm-ok').onclick = () => close(true);
  });
}

/**
 * 알림 모달 열기
 * @param {Object} options - 옵션
 * @param {string} options.title - 제목 (기본값: '알림')
 * @param {string} options.message - 메시지 (기본값: '처리되었습니다.')
 * @param {string} options.okText - 확인 버튼 텍스트 (기본값: '확인')
 * @param {string} options.modalId - 모달 ID (기본값: 'modal-alert')
 * @returns {Promise<void>}
 */
export function openAlert({ 
  title = '알림', 
  message = '처리되었습니다.', 
  okText = '확인',
  modalId = 'modal-alert'
} = {}) {
  return new Promise(resolve => {
    let modal = document.getElementById(modalId);
    
    // 모달이 없으면 동적으로 생성 (백업용)
    if (!modal) {
      console.warn(`${modalId} 요소를 찾을 수 없어 동적으로 생성합니다`);
      modal = createAlertModal(modalId);
    }
    
    if (!modal) {
      return resolve();
    }

    modal.classList.add('is-active');
    const $ = (sel) => modal.querySelector(sel);
    
    $('#alert-title').textContent = title;
    $('#alert-message').textContent = message;
    $('#alert-ok').textContent = okText;

    let cleanup = null;
    
    const close = () => {
      modal.classList.remove('is-active');
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      resolve();
    };

    cleanup = setupModalCloseHandlers(modal, close);
    
    $('#alert-close').onclick = close;
    $('#alert-ok').onclick = close;
  });
}

/**
 * 폼 모달 열기
 * @param {HTMLElement} modal - 모달 요소
 * @param {Function} onSubmit - 제출 콜백
 * @returns {Function} 닫기 함수
 */
export function openFormModal(modal, onSubmit) {
  if (!modal) return () => {};

  modal.classList.add('is-active');
  
  const close = () => {
    modal.classList.remove('is-active');
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  };
  
  cleanup = setupModalCloseHandlers(modal, close);
  
  const background = modal.querySelector('.modal-background');
  if (background) {
    background.onclick = close;
  }
  
  const closeBtn = modal.querySelector('#close-device, [data-modal-close]');
  const cancelBtn = modal.querySelector('#cancel-device, [data-modal-cancel]');
  const submitBtn = modal.querySelector('#submit-device, [data-modal-submit]');
  
  if (closeBtn) closeBtn.onclick = close;
  if (cancelBtn) cancelBtn.onclick = (e) => { e.preventDefault(); close(); };
  
  if (submitBtn && onSubmit) {
    submitBtn.onclick = async (e) => {
      e.preventDefault();
      const form = modal.querySelector('form');
      if (!form) return;
      
      const fd = new FormData(form);
      const payload = Object.fromEntries(fd.entries());
      
      try {
        await onSubmit(payload);
        close();
      } catch (err) {
        const errorEl = modal.querySelector('#form-error, .form-error');
        if (errorEl) {
          errorEl.textContent = err.message || '요청 실패';
          errorEl.classList.remove('is-hidden');
        }
      }
    };
  }
  
  return close;
}

/**
 * 알림 모달 동적 생성 (백업용)
 * @param {string} modalId - 모달 ID (기본값: 'modal-alert')
 * @returns {HTMLElement} 생성된 모달 요소
 */
function createAlertModal(modalId = 'modal-alert') {
  const modal = document.createElement('div');
  modal.className = 'modal is-compact';
  modal.id = modalId;
  modal.innerHTML = `
    <div class="modal-background"></div>
    <div class="modal-card">
      <header class="modal-card-head">
        <p class="modal-card-title" id="alert-title">알림</p>
        <button class="delete" aria-label="close" id="alert-close"></button>
      </header>
      <section class="modal-card-body">
        <p id="alert-message">메시지</p>
      </section>
      <footer class="modal-card-foot is-justify-content-flex-end">
        <button class="button is-primary is-small" id="alert-ok">확인</button>
      </footer>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

