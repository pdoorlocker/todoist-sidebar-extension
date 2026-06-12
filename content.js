(function() {
    const HOST_ID = 'todoist-sidebar-shadow-host';
    const SIDEBAR_ID = 'todo-sidebar-root';
    const TOGGLE_BTN_ID = 'todo-floating-toggle';
    const WIDTH = "400px";

    const TODOIST_COLORS = {
        berry_red: "#b8256f", red: "#db4035", orange: "#ff9933", yellow: "#fad000",
        olive_green: "#afb83b", lime_green: "#7ecc49", green: "#299438", mint_green: "#6accbc",
        teal: "#158fad", sky_blue: "#14aaf5", light_blue: "#96c3eb", blue: "#4073ff",
        grape: "#884dff", violet: "#af38eb", lavender: "#eb96eb", magenta: "#e05194",
        salmon: "#ff8d85", charcoal: "#808080", grey: "#b8b8b8", taupe: "#ccac93"
    };

    if (window.todoistAppController) {
        window.todoistAppController.toggle();
        return;
    }

    // --- SETUP HOST & SHADOW DOM ---
    const oldHost = document.getElementById(HOST_ID);
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647'; 
    host.style.top = '0';
    host.style.right = '0';
    host.style.pointerEvents = 'none'; 
    
    const shadow = host.attachShadow({mode: 'open'});

    const styleLink = document.createElement('link');
    styleLink.setAttribute('rel', 'stylesheet');
    styleLink.setAttribute('href', chrome.runtime.getURL('styles.css'));
    shadow.appendChild(styleLink);

    // --- STATE MANAGEMENT ---
    let sidebar = null;
    let toggleBtn = null;
    let currentView = 'inbox'; 
    let currentGrouping = 'none';
    let currentLabelFilter = null; 
    let collapsedGroups = new Set(); // Merged: Track collapsed groups
    let allProjects = [];
    let allLabels = [];
    let allTasks = {}; 
    let lastMouseDownTarget = null;

    // --- INITIALIZATION ---
    sidebar = createSidebarStructure();
    toggleBtn = createToggleBtn();
    
    shadow.appendChild(sidebar);
    shadow.appendChild(toggleBtn);
    document.body.appendChild(host);

    window.todoistAppController = {
        toggle: () => toggleSidebar()
    };
    
    bindInputEvents();
    bindListEvents(); 
    enableDragAndDrop(); 

    // Initialize by restoring state
    restoreStateAndLoad();

    // --- STATE PERSISTENCE ---
    function saveState() {
        const isOpen = sidebar.classList.contains('open');
        chrome.storage.local.set({
            sidebarState: {
                isOpen: isOpen,
                view: currentView,
                grouping: currentGrouping,
                labelFilter: currentLabelFilter,
                collapsedGroups: Array.from(collapsedGroups) // Merged: Save collapsed state
            }
        });
    }

    function restoreStateAndLoad() {
        chrome.storage.local.get(['sidebarState', 'todoist_token'], (result) => {
            const state = result.sidebarState || {};
            
            if (state.view) currentView = state.view;
            if (state.grouping) currentGrouping = state.grouping;
            if (state.labelFilter) currentLabelFilter = state.labelFilter;
            if (state.collapsedGroups) collapsedGroups = new Set(state.collapsedGroups); // Merged: Restore collapsed state

            const viewSelect = shadow.getElementById('todo-view-select');
            if (viewSelect) viewSelect.value = currentView;
            
            const groupSelect = shadow.getElementById('todo-group-select');
            if (groupSelect) groupSelect.value = currentGrouping;

            // ANIMATION FIX: If open, apply class immediately.
            // The 'no-transition' class is already on sidebar to prevent sliding.
            if (state.isOpen) {
                sidebar.classList.add('open');
                toggleBtn.classList.add('hidden');
                document.documentElement.style.transition = 'none'; // Prevent body shift animation
                document.documentElement.style.marginRight = WIDTH;
            }

            // Remove the block after a short delay to allow future animations
            setTimeout(() => {
                sidebar.classList.remove('no-transition');
                document.documentElement.style.transition = ''; 
            }, 500);

            // Load Data
            if (result.todoist_token) {
                loadData(result.todoist_token.trim());
            } else {
                renderAuthView();
            }
        });
    }

    // --- API HELPER ---
    async function callBackgroundApi(token, method, endpoint, body = null) {
        const path = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
        const isSync = path.includes('sync/v9');
        const baseUrl = isSync ? 'https://api.todoist.com' : 'https://api.todoist.com/rest/v2';
        const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}/${path}`;

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'TODOIST_API_CALL',
                data: { method, url, body, token }
            }, (response) => {
                if (response && response.success) {
                    resolve(response.data);
                } else {
                    console.error("API Error:", response?.error);
                    resolve(null);
                }
            });
        });
    }

    // --- UI COMPONENTS ---
    function createToggleBtn() {
        const btn = document.createElement('button');
        btn.id = TOGGLE_BTN_ID;
        btn.style.pointerEvents = 'auto'; 
        btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
        btn.title = "Open Tasks";
        btn.addEventListener('click', () => toggleSidebar());
        return btn;
    }

    function createSidebarStructure() {
        const div = document.createElement('div');
        div.id = SIDEBAR_ID;
        div.style.pointerEvents = 'auto';
        // VISUAL FIX: Start with no-transition to prevent load-in animation
        div.classList.add('no-transition'); 
        
        div.innerHTML = `
            <div class="todo-header">
                <div class="todo-header-top">
                    <h2 class="brand-title">Tasks</h2>
                    <div class="todo-header-actions">
                        <button id="todo-add-page" class="todo-icon-btn" title="Add current page">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                        </button>
                        <button id="todo-manage-labels" class="todo-icon-btn" title="Manage Labels">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                        </button>
                        <button id="todo-reload" class="todo-icon-btn" title="Refresh">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                        </button>
                        <button id="todo-close" class="todo-icon-btn" title="Close">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>
                <div class="todo-header-filters">
                    <select id="todo-view-select" class="todo-view-select" title="Filter View">
                        <option value="inbox">📥 Inbox</option>
                        <option value="today">📅 Today</option>
                        <option value="all">≡ All Tasks</option>
                        <option disabled>──────────</option>
                    </select>
                </div>
                <div style="margin-top: 8px;">
                    <select id="todo-group-select" class="todo-group-select">
                        <option value="none">No Grouping</option>
                        <option value="label">🏷️ Group by Label</option>
                    </select>
                </div>
            </div>
            
            <div id="todo-body">
                <div id="todo-list">
                    <div class="loading-spinner"></div>
                </div>
            </div>

            <div class="todo-footer">
                <div class="todo-input-area">
                    <div id="new-task-input" class="todo-input-editable" contenteditable="true" placeholder="Add a task..."></div>
                </div>
                <div class="todo-input-cues">
                    <div class="cue-item" id="cue-date"><span class="cue-icon">📅</span> Due Date</div>
                    <div class="cue-item" id="cue-project"><span class="cue-icon">#</span> Project</div>
                    <div class="cue-item" id="cue-label"><span class="cue-icon">@</span> Label</div>
                </div>
            </div>
        `;
        
        div.querySelector('#todo-reload').addEventListener('click', () => checkAuthAndLoad());
        div.querySelector('#todo-close').addEventListener('click', () => toggleSidebar());
        
        div.querySelector('#todo-manage-labels').addEventListener('click', () => {
            chrome.storage.local.get(['todoist_token'], (res) => {
                if (res.todoist_token) openLabelManager(res.todoist_token);
            });
        });
        
        div.querySelector('#todo-view-select').addEventListener('change', (e) => {
            currentView = e.target.value;
            saveState(); 
            triggerRender();
        });

        div.querySelector('#todo-group-select').addEventListener('change', (e) => {
            currentGrouping = e.target.value;
            currentLabelFilter = null; 
            saveState(); 
            triggerRender();
        });

        div.querySelector('#todo-add-page').addEventListener('click', () => addCurrentPageTask());
        
        return div;
    }

    function toggleSidebar() {
        if (!sidebar) sidebar = shadow.getElementById(SIDEBAR_ID);
        if (!sidebar) return;

        const isOpen = sidebar.classList.contains('open');
        const html = document.documentElement;

        if (isOpen) {
            sidebar.classList.remove('open');
            if(toggleBtn) toggleBtn.classList.remove('hidden');
            html.style.transition = "margin-right 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
            html.style.marginRight = "0px";
        } else {
            sidebar.classList.add('open');
            if(toggleBtn) toggleBtn.classList.add('hidden');
            html.style.transition = "margin-right 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
            html.style.marginRight = WIDTH;
        }
        saveState(); 
    }

    function checkAuthAndLoad() {
        chrome.storage.local.get(['todoist_token'], function(result) {
            if (result.todoist_token) {
                const token = result.todoist_token.trim();
                loadData(token);
            } else {
                renderAuthView();
            }
        });
    }

    async function loadData(token) {
        const select = shadow.getElementById('todo-view-select');
        select.disabled = true;

        const [projects, labels] = await Promise.all([
            callBackgroundApi(token, 'GET', 'projects'),
            callBackgroundApi(token, 'GET', 'labels')
        ]);

        if (projects) {
            allProjects = projects;
            while (select.options.length > 3) select.remove(3);
            allProjects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `# ${p.name}`;
                select.appendChild(opt);
            });
            select.value = currentView;
        }

        if (labels) {
            allLabels = labels;
        }

        select.disabled = false;
        renderTaskView(token);
    }

    function renderAuthView() {
        const listContainer = shadow.getElementById('todo-list');
        if(!listContainer) return;
        listContainer.innerHTML = `
            <div class="auth-container">
                <h3>Connect Todoist</h3>
                <p style="font-size:13px; color:#666; margin-bottom:15px;">Paste your API Token from Todoist Settings > Integrations.</p>
                <input type="text" id="api-token-input" class="auth-input" placeholder="Paste API Token here...">
                <button id="save-token-btn" class="save-btn">Connect</button>
            </div>
        `;
        const saveBtn = shadow.getElementById('save-token-btn');
        if(saveBtn) {
            saveBtn.addEventListener('click', () => {
                const input = shadow.getElementById('api-token-input');
                const token = input.value.trim();
                if (token) {
                    chrome.storage.local.set({todoist_token: token}, () => { checkAuthAndLoad(); });
                }
            });
        }
    }

    function triggerRender() {
        chrome.storage.local.get(['todoist_token'], (res) => {
            if (res.todoist_token) renderTaskView(res.todoist_token);
        });
    }

    // --- RENDER LOGIC ---

    async function renderTaskView(token) {
        const listContainer = shadow.getElementById('todo-list');
        if(!listContainer) return;
        
        listContainer.innerHTML = `<div class="loading-spinner"></div>`;
        
        try {
            let endpoint = 'tasks';
            if (currentView === 'today') endpoint += '?filter=today';
            else if (currentView === 'inbox') endpoint += '?filter=%23Inbox';
            else if (currentView === 'all') endpoint += ''; 
            else endpoint += `?project_id=${currentView}`;

            const tasks = await callBackgroundApi(token, 'GET', endpoint);
            
            if (!tasks) throw new Error('Network/Auth Error');
            
            tasks.sort((a, b) => b.priority - a.priority); 
            
            allTasks = {};
            tasks.forEach(t => allTasks[String(t.id)] = t);

            let listHtml = ``;

            if (tasks.length === 0) {
                listHtml = `<div class="empty-state">All clear! 🎉<br>Enjoy your day.</div>`;
            } 
            else if (currentGrouping === 'label') {
                const buckets = {};
                const noLabelBucket = [];
                tasks.forEach(task => {
                    if (!task.labels || task.labels.length === 0) {
                        noLabelBucket.push(task);
                    } else {
                        task.labels.forEach(labelId => {
                            if (!buckets[labelId]) buckets[labelId] = [];
                            buckets[labelId].push(task);
                        });
                    }
                });
                
                const sortedLabelIds = Object.keys(buckets).sort((a, b) => {
                    // Merged: Lookup by ID OR Name (Case Insensitive)
                    const nameA = String(a).toLowerCase();
                    const nameB = String(b).toLowerCase();
                    
                    const lA = allLabels.find(l => String(l.id) === String(a) || l.name.toLowerCase() === nameA);
                    const lB = allLabels.find(l => String(l.id) === String(b) || l.name.toLowerCase() === nameB);
                    return (lA?.order || 0) - (lB?.order || 0);
                });
                
                if (currentLabelFilter) {
                    const filterName = String(currentLabelFilter).toLowerCase();
                    const lObj = allLabels.find(l => String(l.id) === String(currentLabelFilter) || l.name.toLowerCase() === filterName) || { name: 'Unknown', color: 'grey', id: currentLabelFilter };
                    const hexColor = TODOIST_COLORS[lObj.color] || '#808080';
                    
                    listHtml += `
                        <div class="todo-group-header focused" data-group-id="${currentLabelFilter}" style="color:${hexColor}; border-color:${hexColor}40; background:${hexColor}10">
                            <span class="group-color-dot" style="background:${hexColor}"></span>
                            ${lObj.name} (Focused)
                            <span class="group-count">×</span>
                        </div>
                    `;
                    
                    const tasksInBucket = buckets[currentLabelFilter] || [];
                    tasksInBucket.forEach(task => listHtml += generateTaskHtml(task));
                    if (tasksInBucket.length === 0) listHtml += `<div class="empty-state" style="margin-top:20px; font-size:12px;">No tasks in this label.</div>`;

                } else {
                    // Merged: Helper for smooth collapse HTML
                    const generateGroupHtml = (id, name, color, tasks) => {
                        const hexColor = TODOIST_COLORS[color] || '#808080';
                        const isCollapsed = collapsedGroups.has(String(id));
                        
                        let html = `
                            <div class="todo-group-header" data-group-id="${id}" style="color:${hexColor}; border-color:${hexColor}40">
                                <span class="group-collapse-icon ${isCollapsed ? 'collapsed' : ''}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                </span>
                                <span class="group-color-dot" style="background:${hexColor}"></span>
                                ${name}
                                <span class="group-count">${tasks.length}</span>
                            </div>
                            
                            <div class="todo-group-wrapper ${isCollapsed ? 'collapsed' : ''}" id="group-wrapper-${id}">
                                <div class="todo-group-body">
                        `;
                        tasks.forEach(task => html += generateTaskHtml(task));
                        html += `</div></div>`; // Close body and wrapper
                        return html;
                    };

                    sortedLabelIds.forEach(labelId => {
                        const nameId = String(labelId).toLowerCase();
                        // Merged: Case-insensitive grouping logic
                        const lObj = allLabels.find(l => String(l.id) === String(labelId) || l.name.toLowerCase() === nameId) || { name: 'Unknown', color: 'grey' };
                        listHtml += generateGroupHtml(labelId, lObj.name, lObj.color, buckets[labelId]);
                    });
                    
                    if (noLabelBucket.length > 0) {
                        listHtml += generateGroupHtml('NO_LABEL_GROUP', 'No Label', 'grey', noLabelBucket);
                    }
                }
            } else {
                tasks.forEach(task => listHtml += generateTaskHtml(task));
            }
            
            listContainer.innerHTML = listHtml;

        } catch (e) {
            console.error(e);
            listContainer.innerHTML = `<div class="empty-state" style="color:var(--danger-color)">Error loading tasks.<br>Check connection.</div>`;
        }
    }

    function generateTaskHtml(task) {
        const pMap = {4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4'};
        const pClass = pMap[task.priority] || 'p4';
        
        let content = task.content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        let tagsHtml = '';
        if (task.labels && task.labels.length > 0) {
            const labelSpans = task.labels.map(id => {
                const nameId = String(id).toLowerCase();
                const lObj = allLabels.find(l => String(l.id) === String(id) || l.name.toLowerCase() === nameId);
                if (!lObj) return ''; 
                const hex = TODOIST_COLORS[lObj.color] || '#808080';
                return `<span class="todo-tag" style="--tag-color:${hex}">${lObj.name}</span>`;
            }).join('');
            if (labelSpans) tagsHtml = `<div class="todo-tags">${labelSpans}</div>`;
        }
        
        let projectHtml = '';
        const project = allProjects.find(p => String(p.id) === String(task.project_id));
        if (project) {
            projectHtml = `
                <span class="meta-item" title="Project">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; opacity:0.7"><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/></svg>
                    ${project.name}
                </span>
            `;
        }

        let dueHtml = '';
        if (task.due) {
            const isOverdue = task.due.date < new Date().toISOString().split('T')[0];
            const dueClass = isOverdue ? 'overdue' : '';
            const dueText = task.due.string || task.due.date;
            dueHtml = `
                <span class="meta-item ${dueClass}" title="Due Date">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:2px; opacity:0.7"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                    ${dueText}
                </span>
            `;
        }

        let metaRow = '';
        if (projectHtml || dueHtml) {
            metaRow = `<div class="todo-meta-row">${dueHtml}${projectHtml}</div>`;
        }
        
        const labelIdsJson = JSON.stringify(task.labels || []);
        
        return `
            <div class="todo-item" id="task-${task.id}" data-id="${task.id}" data-priority="${task.priority}" data-label-ids='${labelIdsJson}' draggable="false">
                <div class="todo-drag-handle">⋮⋮</div>
                <div class="todo-priority-btn ${pClass}" title="Change Priority"></div>
                <div class="todo-checkbox-wrapper">
                    <input type="checkbox" id="chk-${task.id}" class="todo-checkbox" data-id="${task.id}">
                </div>
                <div class="todo-content-wrapper">
                    <div class="todo-content" title="Click to edit">${content}</div>
                    ${metaRow}
                    ${tagsHtml}
                </div>
            </div>
        `;
    }

    function openLabelManager(token) {
        const overlay = document.createElement('div');
        overlay.className = 'todo-modal-overlay';
        overlay.style.pointerEvents = 'auto';
        
        const sortedLabels = [...allLabels].sort((a,b) => a.order - b.order);

        const rowsHtml = sortedLabels.map(l => {
            const hex = TODOIST_COLORS[l.color] || '#808080';
            const colorOptions = Object.entries(TODOIST_COLORS).map(([name, val]) => 
                `<option value="${name}" ${l.color === name ? 'selected' : ''} style="background:${val};color:${val}">⬤ ${name}</option>`
            ).join('');

            return `
                <div class="label-manager-row" data-id="${l.id}">
                    <select class="label-color-select" style="background:${hex}; color:${hex}" onchange="this.style.background = this.options[this.selectedIndex].style.background; this.style.color = this.style.background;">
                        ${colorOptions}
                    </select>
                    <input type="text" value="${l.name}" onblur="this.dataset.dirty = true">
                </div>
            `;
        }).join('');

        overlay.innerHTML = `
            <div class="todo-modal">
                <div class="todo-modal-header">
                    Manage Labels
                    <button id="mgr-close-btn" style="background:none;border:none;cursor:pointer;font-size:18px;">&times;</button>
                </div>
                <div class="todo-modal-body" style="padding-top:0;">
                    <div class="label-manager-list">
                        ${rowsHtml}
                    </div>
                </div>
                <div class="todo-modal-footer">
                    <button id="mgr-save-btn" class="btn-primary">Save Changes</button>
                </div>
            </div>
        `;

        shadow.appendChild(overlay);
        const close = () => overlay.remove();
        const save = async () => {
            const rows = overlay.querySelectorAll('.label-manager-row');
            const updates = [];
            rows.forEach(row => {
                const id = row.getAttribute('data-id');
                const nameInput = row.querySelector('input');
                const colorSelect = row.querySelector('select');
                const original = allLabels.find(l => String(l.id) === String(id));
                if (original && (original.name !== nameInput.value || original.color !== colorSelect.value)) {
                    updates.push({ id: id, name: nameInput.value, color: colorSelect.value });
                }
            });
            overlay.remove(); 
            for (const u of updates) {
                await callBackgroundApi(token, 'POST', `labels/${u.id}`, { name: u.name, color: u.color });
            }
            loadData(token);
        };
        overlay.querySelector('#mgr-close-btn').addEventListener('click', close);
        overlay.querySelector('#mgr-save-btn').addEventListener('click', save);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    function openEditModal(task, token) {
        const overlay = document.createElement('div');
        overlay.className = 'todo-modal-overlay';
        overlay.style.pointerEvents = 'auto';
        
        const projectOptions = allProjects.map(p => 
            `<option value="${p.id}" ${task.project_id === p.id ? 'selected' : ''}># ${p.name}</option>`
        ).join('');

        const labelsHtml = allLabels.map(l => {
            const isChecked = task.labels && task.labels.some(lbl => String(lbl) === String(l.id) || lbl === l.name);
            const hex = TODOIST_COLORS[l.color] || '#808080';
            return `
            <label class="todo-label-chip ${isChecked ? 'selected' : ''}" style="--chip-color:${hex}">
                <input type="checkbox" value="${l.id}" ${isChecked ? 'checked' : ''} style="display:none">
                <span class="chip-circle"></span>
                ${l.name}
            </label>`;
        }).join('');

        overlay.innerHTML = `
            <div class="todo-modal">
                <div class="todo-modal-header">Edit Task <button id="modal-close-btn" style="background:none;border:none;cursor:pointer;font-size:18px;">&times;</button></div>
                <div class="todo-modal-body">
                    <div class="todo-form-group"><label class="todo-form-label">Content</label><div id="modal-content" class="todo-input-editable" contenteditable="true">${task.content.replace(/</g, '&lt;')}</div></div>
                    <div class="todo-form-group"><label class="todo-form-label">Description</label><textarea id="modal-desc" class="todo-form-textarea">${task.description || ''}</textarea></div>
                    <div class="todo-form-group"><label class="todo-form-label">Project</label><select id="modal-project" class="todo-form-select">${projectOptions}</select></div>
                    <div class="todo-form-group"><label class="todo-form-label">Due Date</label><input type="text" id="modal-due" class="todo-form-input" value="${task.due ? task.due.string : ''}"></div>
                    <div class="todo-form-group"><label class="todo-form-label">Priority</label>
                        <select id="modal-priority" class="todo-form-select">
                            <option value="1" ${task.priority === 1 ? 'selected' : ''}>P4</option>
                            <option value="2" ${task.priority === 2 ? 'selected' : ''}>P3</option>
                            <option value="3" ${task.priority === 3 ? 'selected' : ''}>P2</option>
                            <option value="4" ${task.priority === 4 ? 'selected' : ''}>P1</option>
                        </select>
                    </div>
                    <div class="todo-form-group"><label class="todo-form-label">Labels</label><div id="modal-labels" class="todo-label-chips">${labelsHtml}</div></div>
                </div>
                <div class="todo-modal-footer"><button id="modal-cancel-btn" class="btn-secondary">Cancel</button><button id="modal-save-btn" class="btn-primary">Save Changes</button></div>
            </div>
        `;

        shadow.appendChild(overlay);
        const modalContent = overlay.querySelector('#modal-content');
        attachSyntaxHighlighter(modalContent);
        modalContent.dispatchEvent(new Event('input'));

        const chipContainer = overlay.querySelector('#modal-labels');
        chipContainer.addEventListener('change', (e) => {
            if(e.target.type === 'checkbox') {
                const label = e.target.closest('label');
                if(e.target.checked) label.classList.add('selected');
                else label.classList.remove('selected');
            }
        });

        const close = () => overlay.remove();
        
        const save = async () => {
            const newContentRaw = modalContent.innerText.trim();
            const newDesc = overlay.querySelector('#modal-desc').value;
            const newProject = overlay.querySelector('#modal-project').value;
            const newPriority = parseInt(overlay.querySelector('#modal-priority').value);
            const newDue = overlay.querySelector('#modal-due').value;
            const checkedLabels = Array.from(overlay.querySelectorAll('#modal-labels input:checked')).map(cb => cb.value);

            await processQuickAddEntities(token, newContentRaw);

            let finalContent = newContentRaw;
            let finalProjectId = newProject;
            let finalLabels = checkedLabels;

            const pMatch = newContentRaw.match(/(?:^|\s)#(\w+)/);
            if (pMatch) {
                const pName = pMatch[1];
                const pObj = allProjects.find(p => p.name.toLowerCase() === pName.toLowerCase());
                if(pObj) { finalProjectId = pObj.id; finalContent = finalContent.replace(pMatch[0], ''); }
            }
            const lMatches = [...newContentRaw.matchAll(/(?:^|\s)@(\w+)/g)];
            if (lMatches.length > 0) {
                lMatches.forEach(m => {
                    const lName = m[1];
                    const lObj = allLabels.find(l => l.name.toLowerCase() === lName.toLowerCase());
                    if(lObj) { finalLabels.push(lObj.id); finalContent = finalContent.replace(m[0], ''); }
                });
            }

            const updatedTask = {
                ...allTasks[task.id],
                content: finalContent.trim(),
                description: newDesc,
                project_id: finalProjectId,
                priority: newPriority,
                labels: [...new Set(finalLabels)],
                due: newDue ? { string: newDue, date: newDue, is_recurring: false } : null 
            };
            allTasks[task.id] = updatedTask;

            const oldTaskEl = shadow.getElementById(`task-${task.id}`);
            if (oldTaskEl) {
                const tempContainer = document.createElement('div');
                tempContainer.innerHTML = generateTaskHtml(updatedTask);
                const newTaskEl = tempContainer.firstElementChild;
                oldTaskEl.replaceWith(newTaskEl);
            }

            overlay.remove();

            const labelNames = [...new Set(finalLabels)].map(id => {
                const l = allLabels.find(lbl => String(lbl.id) === String(id));
                return l ? l.name : null;
            }).filter(name => name !== null);

            const payload = {
                content: finalContent.trim(), description: newDesc, project_id: finalProjectId,
                priority: newPriority, 
                labels: labelNames, 
                due_string: newDue || null
            };
            
            await callBackgroundApi(token, 'POST', `tasks/${task.id}`, payload);
        };

        overlay.querySelector('#modal-close-btn').addEventListener('click', close);
        overlay.querySelector('#modal-cancel-btn').addEventListener('click', close);
        overlay.querySelector('#modal-save-btn').addEventListener('click', save);
        
        const inputs = overlay.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                }
            });
        });
        
        modalContent.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            }
        });

        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    }

    function bindListEvents() {
        const list = shadow.getElementById('todo-list');
        list.addEventListener('mousedown', (e) => {
            lastMouseDownTarget = e.target;
            if (e.target.classList.contains('todo-drag-handle')) {
                const item = e.target.closest('.todo-item');
                if(item) item.setAttribute('draggable', 'true');
            }
        });
        list.addEventListener('mouseup', () => {
            const draggables = list.querySelectorAll('.todo-item[draggable="true"]');
            draggables.forEach(el => el.setAttribute('draggable', 'false'));
        });
        list.addEventListener('click', (e) => {
            
            // Merged: Handle Collapse Icon Click (Direct DOM Manipulation)
            const collapseIcon = e.target.closest('.group-collapse-icon');
            if (collapseIcon) {
                e.stopPropagation(); // Stop event from bubbling to the header click
                const groupHeader = collapseIcon.closest('.todo-group-header');
                const groupId = groupHeader.getAttribute('data-group-id');
                const wrapper = groupHeader.nextElementSibling; // The .todo-group-wrapper
                
                if (wrapper && wrapper.classList.contains('todo-group-wrapper')) {
                    // Toggle Class in DOM
                    const isCollapsed = wrapper.classList.contains('collapsed');
                    if (isCollapsed) {
                        wrapper.classList.remove('collapsed');
                        collapseIcon.classList.remove('collapsed');
                        collapsedGroups.delete(groupId);
                    } else {
                        wrapper.classList.add('collapsed');
                        collapseIcon.classList.add('collapsed');
                        collapsedGroups.add(groupId);
                    }
                    saveState(); // Merged: Save state on collapse
                }
                return; // DONE! No render triggered.
            }

            const groupHeader = e.target.closest('.todo-group-header');
            if (groupHeader) {
                const groupId = groupHeader.getAttribute('data-group-id');
                if (currentLabelFilter === groupId) {
                    currentLabelFilter = null; 
                } else {
                    currentLabelFilter = groupId; 
                }
                saveState(); 
                triggerRender();
                return;
            }

            if (e.target.classList.contains('todo-checkbox')) {
                e.stopPropagation(); handleComplete(e.target); return;
            }
            if (e.target.classList.contains('todo-priority-btn')) {
                e.stopPropagation(); handlePriority(e.target); return;
            }
            if (e.target.classList.contains('todo-drag-handle')) return;
            const item = e.target.closest('.todo-item');
            if (item) {
                if (e.target.tagName === 'A') return;
                const taskId = String(item.getAttribute('data-id')); 
                const task = allTasks[taskId];
                if (!task) return;
                chrome.storage.local.get(['todoist_token'], (res) => {
                    if (res.todoist_token) openEditModal(task, res.todoist_token);
                });
            }
        });
    }

    async function handleComplete(checkbox) {
        const taskId = checkbox.getAttribute('data-id');
        const item = shadow.getElementById(`task-${taskId}`);
        item.style.opacity = '0.5';
        item.style.textDecoration = 'line-through';
        chrome.storage.local.get(['todoist_token'], async (res) => {
            if (res.todoist_token) {
                await callBackgroundApi(res.todoist_token, 'POST', `tasks/${taskId}/close`);
                setTimeout(() => item.remove(), 500);
            }
        });
    }

    async function handlePriority(btn) {
        const item = btn.closest('.todo-item');
        const taskId = item.getAttribute('data-id');
        let currentP = parseInt(item.getAttribute('data-priority'));
        let newP = currentP - 1; if (newP < 1) newP = 4;
        const pMap = {4: 'p1', 3: 'p2', 2: 'p3', 1: 'p4'};
        btn.classList.remove('p1', 'p2', 'p3', 'p4'); 
        btn.classList.add(pMap[newP]);
        item.setAttribute('data-priority', newP);
        chrome.storage.local.get(['todoist_token'], async (res) => {
            if (res.todoist_token) {
                await callBackgroundApi(res.todoist_token, 'POST', `tasks/${taskId}`, { priority: newP });
            }
        });
    }

    function enableDragAndDrop() {
        const list = shadow.getElementById('todo-list'); 
        if(!list) return;
        let draggedItem = null;
        list.addEventListener('dragstart', (e) => {
            if (!lastMouseDownTarget || !lastMouseDownTarget.classList.contains('todo-drag-handle')) {
                e.preventDefault(); return false;
            }
            if (e.target.classList.contains('todo-item')) {
                draggedItem = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            }
        });
        list.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('todo-item')) {
                e.target.classList.remove('dragging');
                e.target.setAttribute('draggable', 'false');
                draggedItem = null;
            }
        });
        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = getDragAfterElement(list, e.clientY);
            if (afterElement == null) list.appendChild(draggedItem);
            else list.insertBefore(draggedItem, afterElement);
        });
    }

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.todo-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
            else return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async function processQuickAddEntities(token, text) {
        const cleanText = text.replace(/<[^>]*>/g, '');
        const projectRegex = /(?:^|\s)#(\w+)/g;
        let pMatch;
        while ((pMatch = projectRegex.exec(cleanText)) !== null) {
            const name = pMatch[1];
            if (!allProjects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                 const newP = await callBackgroundApi(token, 'POST', 'projects', { name: name });
                 if(newP) allProjects.push(newP);
            }
        }
        const labelRegex = /(?:^|\s)@(\w+)/g;
        let lMatch;
        while ((lMatch = labelRegex.exec(cleanText)) !== null) {
            const name = lMatch[1];
            if (!allLabels.some(l => l.name.toLowerCase() === name.toLowerCase())) {
                 const newL = await callBackgroundApi(token, 'POST', 'labels', { name: name });
                 if(newL) allLabels.push(newL);
            }
        }
    }

    function addCurrentPageTask() {
        chrome.storage.local.get(['todoist_token'], (res) => {
            if (!res.todoist_token) return;
            const title = document.title;
            const url = window.location.href;
            const markdown = `[${title}](${url})`;
            const btn = shadow.getElementById('todo-add-page'); 
            const originalHTML = btn.innerHTML;
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#28a745" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            setTimeout(() => btn.innerHTML = originalHTML, 1500);
            performQuickAdd(res.todoist_token, markdown);
        });
    }

    async function performQuickAdd(token, text) {
        await processQuickAddEntities(token, text);
        const cleanText = text.replace(/<[^>]*>/g, '');
        await callBackgroundApi(token, 'POST', 'sync/v9/quick/add', { text: cleanText });
        triggerRender();
    }

    function bindInputEvents() {
        const input = shadow.getElementById('new-task-input'); 
        if (!input) return;
        attachSyntaxHighlighter(input);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); 
                const text = input.innerText.trim();
                if (text) {
                    input.innerText = '';
                    ['cue-date','cue-project','cue-label'].forEach(id => {
                       const el = shadow.getElementById(id);
                       if(el) el.className = 'cue-item';
                    });
                    chrome.storage.local.get(['todoist_token'], (res) => {
                        if (res.todoist_token) performQuickAdd(res.todoist_token, text);
                    });
                }
            }
        });
    }

    function attachSyntaxHighlighter(inputElement) {
        inputElement.addEventListener('input', () => {
            if(inputElement.id === 'new-task-input') {
                const text = inputElement.innerText;
                const cues = {
                    date: shadow.getElementById('cue-date'),
                    project: shadow.getElementById('cue-project'),
                    label: shadow.getElementById('cue-label')
                };
                const hasProject = /(?:^|\s)#/.test(text);
                const hasLabel = /(?:^|\s)@/.test(text);
                const dateRegex = /(?:^|\s)(today|tomorrow|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)(?:\s|$)/i;
                const hasDate = dateRegex.test(text);
                if (cues.project) cues.project.classList.toggle('active', hasProject);
                if (cues.label) cues.label.classList.toggle('active', hasLabel);
                if (cues.date) cues.date.classList.toggle('active', hasDate);
                if (cues.date) cues.date.classList.toggle('date-cue', hasDate);
                if (cues.project) cues.project.classList.toggle('project-cue', hasProject);
                if (cues.label) cues.label.classList.toggle('label-cue', hasLabel);
            }
            const caretPos = getCaretCharacterOffsetWithin(inputElement);
            const text = inputElement.innerText;
            let html = text
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                .replace(/(?:^|\s)(#\w+)/g, (match) => {
                    return `${match.charAt(0) === ' ' ? ' ' : ''}<span class="input-badge project ${allProjects.some(p => p.name.toLowerCase() === match.trim().replace('#','').toLowerCase()) ? '' : 'new'}">${match.trim()}</span>`;
                })
                .replace(/(?:^|\s)(@\w+)/g, (match) => {
                    return `${match.charAt(0) === ' ' ? ' ' : ''}<span class="input-badge label ${allLabels.some(l => l.name.toLowerCase() === match.trim().replace('@','').toLowerCase()) ? '' : 'new'}">${match.trim()}</span>`;
                })
                .replace(/(?:^|\s)(today|tomorrow|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\sweek|next\smonth)(?:\s|$)/gi, (match) => {
                    return `<span class="input-badge date">${match}</span>`;
                });
            if (inputElement.innerHTML !== html) {
                inputElement.innerHTML = html;
                setCaretPosition(inputElement, caretPos);
            }
        });
    }

    function getCaretCharacterOffsetWithin(element) {
        let caretOffset = 0;
        const sel = shadow.getSelection(); 
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(element);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            caretOffset = preCaretRange.toString().length;
        }
        return caretOffset;
    }

    function setCaretPosition(element, offset) {
        const range = document.createRange();
        const sel = shadow.getSelection();
        let currentNode = null;
        let charCount = 0;
        function traverseNodes(node) {
            if (node.nodeType === 3) { 
                if (charCount + node.length >= offset) {
                    currentNode = node;
                    return true;
                }
                charCount += node.length;
            } else {
                for (let i = 0; i < node.childNodes.length; i++) {
                    if (traverseNodes(node.childNodes[i])) return true;
                }
            }
            return false;
        }
        traverseNodes(element);
        if (currentNode) {
            range.setStart(currentNode, offset - charCount);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        } else {
            range.selectNodeContents(element);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
        }
    }
})();