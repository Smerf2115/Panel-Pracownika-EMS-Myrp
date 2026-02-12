// ============================================
// GLOBALS
// ============================================
let currentUser = null;
let allMembersData = [];
let selectedMemberIds = [];
let filteredMIAMembers = [];

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    start();
    setupSidebar();
    setupSearches();
});

async function start() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        if (error) {
            showToast('Błąd logowania: ' + error, 'error');
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        const mRes = await fetch('/api/ems-members');
        allMembersData = await mRes.json();
        renderFullList(allMembersData);

        const uRes = await fetch('/api/user');
        currentUser = await uRes.json();

        if (currentUser && currentUser.id) {
            renderAuthPanel();
            document.getElementById('panel-gate-locked').classList.add('hidden');
            document.getElementById('panel-gate-unlocked').classList.remove('hidden');

            if (currentUser.isZarzad || currentUser.isMIA) {
                document.getElementById('admin-action-tile').classList.remove('hidden');
            }
        } else {
            document.getElementById('auth-panel').innerHTML = `
                <a href="/login" class="login-btn">ZALOGUJ PRZEZ DISCORD</a>
            `;
        }
    } catch (e) {
        console.error("Init error:", e);
        showToast('Błąd ładowania danych', 'error');
    }
}

// ============================================
// SIDEBAR
// ============================================
function setupSidebar() {
    const items = document.querySelectorAll('.sidebar-item');
    items.forEach(item => {
        item.addEventListener('click', () => {
            const section = item.getAttribute('data-section');
            
            items.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
            document.getElementById(`section-${section}`).classList.add('active');
        });
    });
}

// ============================================
// SEARCH
// ============================================
function setupSearches() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = allMembersData.filter(m => 
                m.username.toLowerCase().includes(query)
            );
            renderFullList(filtered);
        });
    }

    const miaSearch = document.getElementById('mia-search');
    if (miaSearch) {
        miaSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            filteredMIAMembers = allMembersData.filter(m => 
                m.username.toLowerCase().includes(query)
            );
            renderMIAMembersList();
        });
    }
}

// ============================================
// RENDER MEMBERS
// ============================================
function renderFullList(members) {
    const grid = document.getElementById('members-grid');
    if (!grid) return;

    grid.innerHTML = members.map(m => `
        <div class="member-card">
            <div class="member-header">
                <img src="${m.avatar}" alt="${m.username}" class="member-avatar">
                <div class="member-info">
                    <div class="member-name">${m.username}</div>
                    <div class="member-rank">${m.rank || 'Brak rangi'}</div>
                </div>
                <div class="member-status ${m.status}"></div>
            </div>
        </div>
    `).join('');
}

function renderAuthPanel() {
    const panel = document.getElementById('auth-panel');
    if (!panel || !currentUser) return;

    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
            <img src="${currentUser.avatar}" alt="${currentUser.username}" 
                 style="width:36px;height:36px;border-radius:50%;border:2px solid rgba(255,255,255,0.1);">
            <div>
                <div style="font-size:13px;font-weight:700;">${currentUser.username}</div>
                <a href="/logout" style="font-size:11px;color:rgba(255,255,255,0.4);text-decoration:none;font-weight:600;">Wyloguj</a>
            </div>
        </div>
    `;
}

// ============================================
// MODALS - RAPORT
// ============================================
function openReportModal() {
    document.getElementById('report-modal').classList.add('active');
}

function closeReportModal() {
    document.getElementById('report-modal').classList.remove('active');
}

async function submitReport() {
    const type = document.getElementById('report-type').value;
    const description = document.getElementById('report-desc').value;

    if (!description.trim()) {
        showToast('Wypełnij opis!', 'error');
        return;
    }

    try {
        const res = await fetch('/api/send-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, description })
        });

        if (res.ok) {
            showToast('Raport wysłany!', 'success');
            closeReportModal();
            document.getElementById('report-desc').value = '';
        } else {
            throw new Error('Failed');
        }
    } catch (e) {
        showToast('Błąd wysyłania', 'error');
    }
}

// ============================================
// MODALS - URLOP
// ============================================
function openHolidayModal() {
    document.getElementById('holiday-modal').classList.add('active');
}

function closeHolidayModal() {
    document.getElementById('holiday-modal').classList.remove('active');
}

async function submitHoliday() {
    const endDate = document.getElementById('holiday-date').value;
    const reason = document.getElementById('holiday-reason').value;

    if (!endDate) {
        showToast('Wybierz datę!', 'error');
        return;
    }

    try {
        const res = await fetch('/api/holiday', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endDate, reason })
        });

        if (res.ok) {
            showToast('Urlop zgłoszony!', 'success');
            closeHolidayModal();
            document.getElementById('holiday-date').value = '';
            document.getElementById('holiday-reason').value = '';
        } else {
            throw new Error('Failed');
        }
    } catch (e) {
        showToast('Błąd zgłoszenia', 'error');
    }
}

// ============================================
// MODALS - MIA
// ============================================
function openMIAModal() {
    document.getElementById('mia-modal').classList.add('active');
    selectedMemberIds = [];
    filteredMIAMembers = [...allMembersData];
    renderMIAMembersList();
    renderSelectedPills();
    updatePreview();
}

function closeMIAModal() {
    document.getElementById('mia-modal').classList.remove('active');
    selectedMemberIds = [];
    document.getElementById('mia-reason').value = '';
}

function renderMIAMembersList() {
    const list = document.getElementById('mia-members-list');
    if (!list) return;

    list.innerHTML = filteredMIAMembers.map(m => `
        <div class="mia-member-item ${selectedMemberIds.includes(m.id) ? 'selected' : ''}" 
             onclick="toggleMember('${m.id}')">
            <div class="mia-member-checkbox"></div>
            <img src="${m.avatar}" alt="${m.username}" class="mia-member-avatar">
            <div class="mia-member-name">${m.username}</div>
            <div class="mia-member-badge">${m.rank || 'Brak'}</div>
        </div>
    `).join('');
}

function toggleMember(id) {
    if (selectedMemberIds.includes(id)) {
        selectedMemberIds = selectedMemberIds.filter(i => i !== id);
    } else {
        selectedMemberIds.push(id);
    }
    renderMIAMembersList();
    renderSelectedPills();
    updatePreview();
}

function renderSelectedPills() {
    const container = document.getElementById('selected-members-container');
    if (!container) return;

    if (selectedMemberIds.length === 0) {
        container.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:12px;padding:10px 0;">Nie wybrano nikogo</div>';
        return;
    }

    container.innerHTML = selectedMemberIds.map(id => {
        const member = allMembersData.find(m => m.id === id);
        if (!member) return '';
        return `
            <div class="selected-pill">
                <img src="${member.avatar}" alt="${member.username}" class="pill-avatar">
                <span>${member.username}</span>
                <span class="pill-remove" onclick="event.stopPropagation();toggleMember('${id}')">✕</span>
            </div>
        `;
    }).join('');
}

function onActionTypeChange() {
    updatePreview();
}

function updatePreview() {
    const type = document.getElementById('mia-action-type').value;
    const reason = document.getElementById('mia-reason').value;

    const icons = {
        plus: '✅',
        minus: '❌',
        pochwala: '🏅',
        upomnienie: '⚠️',
        nagana: '🔴',
        zawieszenie: '🚫',
        wezwanie: '📢'
    };

    const labels = {
        plus: 'Plus',
        minus: 'Minus',
        pochwala: 'Pochwała',
        upomnienie: 'Upomnienie',
        nagana: 'Nagana',
        zawieszenie: 'Zawieszenie',
        wezwanie: 'Wezwanie'
    };

    document.querySelector('.preview-icon').textContent = icons[type] || '✅';
    document.querySelector('.preview-title').textContent = labels[type] || 'Akcja';
    document.getElementById('preview-count').textContent = selectedMemberIds.length;
    document.getElementById('preview-reason').textContent = reason || '-';
}

document.getElementById('mia-reason')?.addEventListener('input', updatePreview);

async function submitMIAAction() {
    if (selectedMemberIds.length === 0) {
        showToast('Wybierz przynajmniej jednego członka!', 'error');
        return;
    }

    const type = document.getElementById('mia-action-type').value;
    const reason = document.getElementById('mia-reason').value;

    if (!reason.trim()) {
        showToast('Podaj powód akcji!', 'error');
        return;
    }

    try {
        const res = await fetch('/api/mia-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetIds: selectedMemberIds,
                type,
                reason
            })
        });

        const data = await res.json();

        if (res.ok) {
            showToast(data.message || 'Akcja wykonana!', 'success');
            closeMIAModal();
        } else {
            showToast(data.error || 'Błąd akcji', 'error');
        }
    } catch (e) {
        showToast('Błąd połączenia', 'error');
    }
}

// ============================================
// TOAST
// ============================================
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
