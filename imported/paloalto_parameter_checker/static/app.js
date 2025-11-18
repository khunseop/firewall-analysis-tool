// Palo Alto Parameter Checker - 클라이언트 JavaScript

class ParameterChecker {
    constructor() {
        this.currentParameters = [];
        this.isEditing = false;
        this.editingId = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadParameters();
    }

    bindEvents() {
        // 매개변수 검색 이벤트
        const searchInput = document.getElementById('parameterSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => this.filterParameters(e.target.value));
        }

        // 점검 관련 이벤트
        // Bind check button
        const checkButton = document.getElementById('checkButton');
        if (checkButton) {
            checkButton.addEventListener('click', () => this.runCheck());
        }

        // Bind export button
        const downloadExcelBtn = document.getElementById('downloadExcelBtn');
        if (downloadExcelBtn) {
            downloadExcelBtn.addEventListener('click', () => this.downloadReport('excel'));
        }

        // 매개변수 관리 이벤트
        const saveParameterBtn = document.getElementById('saveParameterBtn');
        if (saveParameterBtn) {
            saveParameterBtn.addEventListener('click', () => this.saveParameter());
        }

        const parametersTab = document.getElementById('parameters-tab');
        if (parametersTab) {
            parametersTab.addEventListener('click', () => this.loadParameters());
        }

        // 설정 관리 이벤트
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportSettings());
        }

        const importFileInput = document.getElementById('importFileInput');
        if (importFileInput) {
            importFileInput.addEventListener('change', () => this.importSettings());
        }

        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const fileInput = document.getElementById('importFileInput');
                if (fileInput) {
                    fileInput.click();
                }
            });
        }

        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSettings());
        }

        // 모달 초기화 이벤트
        const parameterModal = document.getElementById('parameterModal');
        if (parameterModal) {
            parameterModal.addEventListener('hidden.bs.modal', () => this.resetParameterForm());
        }
    }

    // 유틸리티 함수들
    showAlert(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = message;
        
        const container = document.getElementById('toastContainer');
        container.appendChild(toast);
        
        // Trigger reflow to enable transition
        toast.offsetHeight;
        toast.classList.add('show');
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async apiCall(url, options = {}) {
        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            console.error('API call failed:', error);
            throw error;
        }
    }

    // 점검 관련 함수들
    async runCheck() {
        const host = document.getElementById('hostInput').value.trim();
        const username = document.getElementById('usernameInput').value.trim();
        const password = document.getElementById('passwordInput').value.trim();

        if (!host || !username || !password) {
            this.showAlert('Please fill in all fields.', 'warning');
            return;
        }

        this.setCheckingState(true);

        try {
            const result = await this.apiCall('/api/check', {
                method: 'POST',
                body: JSON.stringify({ host, username, password })
            });

            if (result.success) {
                this.displayResults(result.results, result.summary);
                this.showAlert('Check completed.', 'success');
                
                // 다운로드 버튼 활성화
                document.getElementById('downloadExcelBtn').disabled = false;
                document.getElementById('downloadHtmlBtn').disabled = false;
            } else {
                this.showAlert(result.message, 'danger');
            }
        } catch (error) {
            this.showAlert(`Check failed: ${error.message}`, 'error');
        } finally {
            this.setCheckingState(false);
        }
    }

    setCheckingState(checking) {
        const button = document.getElementById('checkButton');
        const buttonText = document.getElementById('checkButtonText');
        const spinner = document.getElementById('checkSpinner');

        if (checking) {
            button.disabled = true;
            buttonText.textContent = 'Checking...';
            spinner.classList.remove('d-none');
        } else {
            button.disabled = false;
            buttonText.textContent = 'Check';
            spinner.classList.add('d-none');
        }
    }

    displayResults(results, summary) {
        // 요약 정보 업데이트
        document.getElementById('totalCount').textContent = summary.total;
        document.getElementById('passCount').textContent = summary.pass;
        document.getElementById('failCount').textContent = summary.fail;
        document.getElementById('errorCount').textContent = summary.error;
        document.getElementById('summarySection').classList.remove('d-none');

        // 결과 테이블 업데이트
        const tbody = document.getElementById('resultsTableBody');
        tbody.innerHTML = '';

        results.forEach(result => {
            const row = document.createElement('tr');
            row.className = `status-${result.status}`;
            
            const statusIcon = {
                'PASS': '✅',
                'FAIL': '❌', 
                'ERROR': '⚠️'
            }[result.status] || '❓';

            row.innerHTML = `
                <td><strong>${result.parameter}</strong></td>
                <td>${result.expected}</td>
                <td>${result.current}</td>
                <td>${statusIcon} ${result.status}</td>
                <td><span class="command-text">${result.query_method}</span></td>
                <td><span class="command-text">${result.modify_method}</span></td>
            `;
            
            tbody.appendChild(row);
        });
    }

    async downloadReport(format) {
        try {
            const response = await fetch(`/api/download/${format}`);
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            
            const filename = response.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') 
                || `report.${format === 'excel' ? 'xlsx' : 'html'}`;
            
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.showAlert(`${format.toUpperCase()} report download completed`, 'success');
        } catch (error) {
            this.showAlert(`Report download failed: ${error.message}`, 'danger');
        }
    }

    // 매개변수 관리 함수들
    async loadParameters() {
        try {
            const result = await this.apiCall('/api/parameters');
            
            if (result.success) {
                this.currentParameters = result.parameters;
                this.displayParameters();
            } else {
                this.showAlert('Parameter loading failed', 'danger');
            }
        } catch (error) {
            this.showAlert(`Parameter loading failed: ${error.message}`, 'danger');
        }
    }

    filterParameters(searchText) {
        const filteredParams = this.currentParameters.filter(param => {
            const searchLower = searchText.toLowerCase();
            return param.name.toLowerCase().includes(searchLower) ||
                   param.description.toLowerCase().includes(searchLower) ||
                   param.command.toLowerCase().includes(searchLower) ||
                   param.pattern.toLowerCase().includes(searchLower);
        });
        this.displayParameters(filteredParams);
    }

    displayParameters(parameters = this.currentParameters) {
        const tbody = document.getElementById('parametersTableBody');
        tbody.innerHTML = '';

        if (parameters.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-4">
                        No parameters registered. Add a new parameter.
                    </td>
                </tr>
            `;
            return;
        }

        this.currentParameters.forEach(param => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${param.name}</strong></td>
                <td>${param.description}</td>
                <td>${param.expected_value}</td>
                <td><span class="command-text">${param.command}</span></td>
                <td><code>${param.pattern}</code></td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-link btn-sm text-primary px-1" onclick="app.editParameter(${param.id})" title="Edit parameter">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="btn btn-link btn-sm text-danger px-1" onclick="app.deleteParameter(${param.id})" title="Delete parameter">
                            <i class="fa-solid fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    editParameter(id) {
        const param = this.currentParameters.find(p => p.id === id);
        if (!param) return;

        this.isEditing = true;
        this.editingId = id;

        // 모달 제목 변경
        document.getElementById('parameterModalTitle').textContent = '매개변수 수정';
        
        // 폼에 데이터 채우기
        document.getElementById('parameterIdInput').value = param.id;
        document.getElementById('nameInput').value = param.name;
        document.getElementById('descriptionInput').value = param.description;
        document.getElementById('expectedValueInput').value = param.expected_value;
        document.getElementById('commandInput').value = param.command;
        document.getElementById('modifyCommandInput').value = param.modify_command;
        document.getElementById('patternInput').value = param.pattern;

        // 모달 표시
        const modal = new bootstrap.Modal(document.getElementById('parameterModal'));
        modal.show();
    }

    async deleteParameter(id) {
        if (!confirm('Are you sure you want to delete this parameter?')) {
            return;
        }

        try {
            const result = await this.apiCall(`/api/parameters/${id}`, {
                method: 'DELETE'
            });

            if (result.success) {
                this.showAlert(result.message, 'success');
                this.loadParameters();
            } else {
                this.showAlert(result.message, 'danger');
            }
        } catch (error) {
            this.showAlert(`Delete failed: ${error.message}`, 'error');
        }
    }

    async saveParameter() {
        const formData = {
            name: document.getElementById('nameInput').value.trim(),
            description: document.getElementById('descriptionInput').value.trim(),
            expected_value: document.getElementById('expectedValueInput').value.trim(),
            command: document.getElementById('commandInput').value.trim(),
            modify_command: document.getElementById('modifyCommandInput').value.trim(),
            pattern: document.getElementById('patternInput').value.trim()
        };

        // 필수 필드 검증
        const requiredFields = Object.keys(formData);
        for (const field of requiredFields) {
            if (!formData[field]) {
                this.showAlert(`${field} is required.`, 'warning');
                return;
            }
        }

        try {
            let result;
            
            if (this.isEditing) {
                // 수정
                result = await this.apiCall(`/api/parameters/${this.editingId}`, {
                    method: 'PUT',
                    body: JSON.stringify(formData)
                });
            } else {
                // 추가
                result = await this.apiCall('/api/parameters', {
                    method: 'POST',
                    body: JSON.stringify(formData)
                });
            }

            if (result.success) {
                this.showAlert(result.message, 'success');
                this.loadParameters();
                
                // 모달 닫기
                const modal = bootstrap.Modal.getInstance(document.getElementById('parameterModal'));
                modal.hide();
            } else {
                this.showAlert(result.message, 'danger');
            }
        } catch (error) {
            this.showAlert(`Save failed: ${error.message}`, 'danger');
        }
    }

    resetParameterForm() {
        this.isEditing = false;
        this.editingId = null;
        
        document.getElementById('parameterModalTitle').textContent = 'Add Parameter';
        document.getElementById('parameterForm').reset();
        document.getElementById('parameterIdInput').value = '';
    }

    // 설정 관리 함수들
    async exportSettings() {
        if (!confirm('Are you sure you want to export all parameters?')) {
            return;
        }

        try {
            const result = await this.apiCall('/api/export');
            
            // JSON 파일로 다운로드
            const blob = new Blob([JSON.stringify(result, null, 2)], {
                    type: 'application/json'
                });
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `palo_alto_parameters_${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.showAlert('Export completed', 'success');
        } catch (error) {
            this.showAlert(`Export failed: ${error.message}`, 'danger');
        }
    }

    async importSettings() {
        const fileInput = document.getElementById('importFileInput');
        const file = fileInput.files[0];
        
        if (!file) {
            this.showAlert('Please select a file to import.', 'warning');
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            const result = await this.apiCall('/api/import', {
                method: 'POST',
                body: JSON.stringify(data)
            });

            if (result.success) {
                this.showAlert(result.message, 'success');
                this.loadParameters();
                fileInput.value = ''; // 파일 입력 초기화
            } else {
                this.showAlert(result.message, 'danger');
            }
        } catch (error) {
            this.showAlert(`Import failed: ${error.message}`, 'danger');
        }
    }

    async resetSettings() {
        if (!confirm('Are you sure you want to reset all parameters to default values?\nAll existing settings will be deleted.')) {
            return;
        }

        try {
            const result = await this.apiCall('/api/reset', {
                method: 'POST'
            });

            if (result.success) {
                this.showAlert(result.message, 'success');
                this.loadParameters();
            } else {
                this.showAlert(result.message, 'danger');
            }
        } catch (error) {
            this.showAlert(`Reset failed: ${error.message}`, 'danger');
        }
    }
}

// 앱 초기화
const app = new ParameterChecker();