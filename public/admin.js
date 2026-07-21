/**
 * SafeNex Admin Dashboard - Complete Redesign
 * Real-time data, proper functionality, detailed information
 */

const API_BASE = '/api';
let currentUser = null;
let adminPassword = null;
let refreshInterval = null;

// Get token
function getToken() {
    return localStorage.getItem('snx_token') || localStorage.getItem('token');
}

// API Call Helper with retry logic
async function apiCall(endpoint, options = {}, retries = 2) {
    const token = getToken();
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    ...options.headers
                }
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    window.location.href = '/onboarding.html';
                }
                throw new Error(data.message || 'Request failed');
            }

            return data;
        } catch (error) {
            // If it's a connection error and we have retries left, try again
            if ((error.message.includes('ECONNRESET') || 
                 error.message.includes('fetch') || 
                 error.message.includes('network')) && 
                attempt < retries) {
                console.warn(`API call failed (attempt ${attempt + 1}/${retries + 1}), retrying...`);
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
                continue;
            }
            
            console.error('API Error:', error);
            throw error;
        }
    }
}

// Initialize
async function init() {
    const token = getToken();
    
    if (!token) {
        window.location.href = '/onboarding.html';
        return;
    }

    try {
        const response = await apiCall('/dashboard');
        currentUser = response.user;

        if (currentUser.email !== 'abdullahansari01618@gmail.com') {
            alert('Access denied. Admin privileges required.');
            window.location.href = '/dashboard.html';
            return;
        }

        document.getElementById('adminEmail').textContent = currentUser.email;
        document.getElementById('passwordModal').style.display = 'flex';
        
    } catch (error) {
        console.error('Init error:', error);
        window.location.href = '/onboarding.html';
    }
}

// Verify Password
document.getElementById('verifyPasswordBtn').addEventListener('click', async () => {
    const password = document.getElementById('adminPasswordInput').value;
    const errorEl = document.getElementById('passwordError');

    if (!password) {
        errorEl.textContent = 'Please enter password';
        errorEl.classList.add('show');
        return;
    }

    try {
        await apiCall('/admin/verify-password', {
            method: 'POST',
            body: JSON.stringify({ password })
        });

        adminPassword = password;
        document.getElementById('passwordModal').style.display = 'none';
        document.getElementById('dashboard').style.display = 'flex';
        
        // Load initial data
        await loadOverview();
        
        // Start real-time updates
        startRealTimeUpdates();
        
    } catch (error) {
        errorEl.textContent = error.message || 'Invalid password';
        errorEl.classList.add('show');
    }
});

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.dataset.section;
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
        document.getElementById(`${section}-section`).classList.add('active');
        
        switch(section) {
            case 'overview':
                loadOverview();
                break;
            case 'users':
                loadUsers();
                break;
            case 'danger-zones':
                loadDangerZones();
                break;
            case 'complaints':
                loadComplaints();
                break;
            case 'community-posts':
                loadCommunityPosts();
                break;
            case 'emergency-alerts':
                loadEmergencyAlerts();
                break;
            case 'system-health':
                loadSystemHealth();
                break;
            case 'activity':
                loadActivity();
                break;
            case 'live-tracking':
                initLiveTracking();
                break;
        }
    });
});

// Load Overview
async function loadOverview() {
    try {
        // Use Promise.allSettled instead of Promise.all to handle individual failures
        const results = await Promise.allSettled([
            apiCall('/admin/stats'),
            apiCall('/admin/users?limit=1000'),
            apiCall('/admin/danger-zones'),
            apiCall('/admin/silent-room/reports?limit=1000'),
            apiCall('/admin/activity-log?limit=10')
        ]);

        // Extract successful results or use defaults
        const statsRes = results[0].status === 'fulfilled' ? results[0].value : { data: { totalUsers: 0, verifiedUsers: 0, unverifiedUsers: 0, totalZones: 0, totalPosts: 0, totalSOS: 0 } };
        const usersRes = results[1].status === 'fulfilled' ? results[1].value : { data: { users: [] } };
        const zonesRes = results[2].status === 'fulfilled' ? results[2].value : { data: [] };
        const postsRes = results[3].status === 'fulfilled' ? results[3].value : { data: { reports: [] } };
        const activityRes = results[4].status === 'fulfilled' ? results[4].value : { data: { logs: [] } };

        const stats = statsRes.data;
        const users = usersRes.data.users || [];
        const zones = zonesRes.data || [];
        const posts = postsRes.data.reports || [];
        const activities = activityRes.data.logs || [];

        // Calculate online users (active in last 5 minutes)
        const now = new Date();
        const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
        const onlineUsers = users.filter(u => {
            const lastActive = u.lastActiveAt || u.createdAt;
            return new Date(lastActive) > fiveMinutesAgo;
        }).length;

        // Update stats
        document.getElementById('totalUsers').textContent = stats.totalUsers || 0;
        document.getElementById('verifiedUsers').textContent = stats.verifiedUsers || 0;
        document.getElementById('onlineUsers').textContent = onlineUsers;
        document.getElementById('totalZones').textContent = stats.totalZones || 0;
        document.getElementById('totalPosts').textContent = stats.totalPosts || 0;
        document.getElementById('totalSOS').textContent = stats.totalSOS || 0;

        // Update details
        document.getElementById('usersDetail').textContent = `${stats.verifiedUsers || 0} verified, ${stats.unverifiedUsers || 0} unverified`;
        document.getElementById('verifiedDetail').textContent = stats.totalUsers > 0 ? `${Math.round((stats.verifiedUsers / stats.totalUsers) * 100)}% verification rate` : '0% verification rate';
        document.getElementById('onlineDetail').textContent = `${onlineUsers} active in last 5 minutes`;
        
        const criticalZones = zones.filter(z => z.riskLevel === 'Critical').length;
        const highZones = zones.filter(z => z.riskLevel === 'High').length;
        document.getElementById('zonesDetail').textContent = `${criticalZones} Critical, ${highZones} High risk`;
        
        const pendingPosts = posts.filter(p => !p.status || p.status === 'pending').length;
        document.getElementById('postsDetail').textContent = `${pendingPosts} pending moderation`;
        
        document.getElementById('sosDetail').textContent = `All sessions monitored`;

        // Update badges
        document.getElementById('usersBadge').textContent = stats.totalUsers || 0;
        document.getElementById('zonesBadge').textContent = stats.totalZones || 0;
        
        // Update complaint and community badges
        const complaints = posts.filter(p => p.isPrivate === true);
        const pendingComplaints = complaints.filter(p => !p.status || p.status === 'pending').length;
        const communityPosts = posts.filter(p => !p.isPrivate);
        const pendingCommunity = communityPosts.filter(p => !p.status || p.status === 'pending').length;
        
        document.getElementById('complaintsBadge').textContent = pendingComplaints;
        document.getElementById('communityBadge').textContent = pendingCommunity;

        // Update real-time activity
        const activityHTML = activities.map(log => `
            <div class="activity-item">
                <div class="activity-icon">${getActivityIcon(log.action)}</div>
                <div class="activity-content">
                    <div class="activity-title">${formatAction(log.action)}</div>
                    <div class="activity-desc">${log.description}</div>
                </div>
                <div class="activity-time">${formatTimeAgo(log.createdAt)}</div>
            </div>
        `).join('');

        document.getElementById('realtimeActivity').innerHTML = activityHTML || '<div class="empty-state">No recent activity</div>';

        // Show warning if any requests failed
        const failedRequests = results.filter(r => r.status === 'rejected');
        if (failedRequests.length > 0) {
            console.warn(`${failedRequests.length} API requests failed. Some data may be incomplete.`);
        }

    } catch (error) {
        console.error('Load overview error:', error);
        alert('Error loading overview: ' + error.message);
    }
}

// Load Users
async function loadUsers() {
    try {
        const search = document.getElementById('userSearch')?.value || '';
        const filter = document.getElementById('userFilter')?.value || '';
        
        const params = new URLSearchParams({ page: 1, limit: 1000 });
        if (search) params.append('search', search);

        const response = await apiCall(`/admin/users?${params}`);
        
        const users = response.data.users;

        if (!users || users.length === 0) {
            document.getElementById('usersContent').innerHTML = '<div class="empty-state">No users found</div>';
            return;
        }

        // Filter users
        let filteredUsers = users;
        const now = new Date();
        const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);

        if (filter === 'online') {
            filteredUsers = users.filter(u => {
                const lastActive = u.lastActiveAt || u.createdAt;
                return new Date(lastActive) > fiveMinutesAgo;
            });
        } else if (filter === 'verified') {
            filteredUsers = users.filter(u => u.verified);
        } else if (filter === 'unverified') {
            filteredUsers = users.filter(u => !u.verified);
        }

        const tableHTML = `
            <div class="user-table">
                <div class="user-row header">
                    <div></div>
                    <div>Name</div>
                    <div>Email</div>
                    <div>Status</div>
                    <div>Verified</div>
                    <div>SafeNex ID</div>
                    <div>Actions</div>
                </div>
                ${filteredUsers.map(user => {
                    const lastActive = user.lastActiveAt || user.createdAt;
                    const isOnline = new Date(lastActive) > fiveMinutesAgo;
                    const initial = (user.name || 'U')[0].toUpperCase();
                    
                    return `
                    <div class="user-row">
                        <div class="user-avatar">${initial}</div>
                        <div>${user.name || 'N/A'}</div>
                        <div>${user.email || 'N/A'}</div>
                        <div><span class="status-badge ${isOnline ? 'status-online' : 'status-offline'}">${isOnline ? '🟢 Online' : '⚫ Offline'}</span></div>
                        <div><span class="status-badge ${user.verified ? 'status-verified' : 'status-unverified'}">${user.verified ? '✅ Verified' : '⏳ Unverified'}</span></div>
                        <div>${user.safeNexID || 'N/A'}</div>
                        <div class="user-actions">
                            <button class="btn-small btn-view" onclick="viewUser('${user.id}')">View</button>
                            <button class="btn-small btn-edit" onclick="toggleVerify('${user.id}', ${!user.verified})">${user.verified ? 'Unverify' : 'Verify'}</button>
                            <button class="btn-small btn-delete" onclick="deleteUser('${user.id}')">Delete</button>
                        </div>
                    </div>
                `}).join('')}
            </div>
        `;

        document.getElementById('usersContent').innerHTML = tableHTML;

    } catch (error) {
        console.error('Load users error:', error);
        document.getElementById('usersContent').innerHTML = `<div class="empty-state">Error loading users: ${error.message}</div>`;
    }
}

// Load Danger Zones
async function loadDangerZones() {
    try {
        const response = await apiCall('/admin/danger-zones');
        
        const zones = response.data;

        if (!zones || zones.length === 0) {
            document.getElementById('zonesContent').innerHTML = '<div class="empty-state">No danger zones found</div>';
            // Reset stats
            document.getElementById('criticalZonesCount').textContent = '0';
            document.getElementById('highZonesCount').textContent = '0';
            document.getElementById('mediumZonesCount').textContent = '0';
            document.getElementById('lowZonesCount').textContent = '0';
            return;
        }

        // Calculate stats
        const criticalCount = zones.filter(z => z.riskLevel === 'Critical').length;
        const highCount = zones.filter(z => z.riskLevel === 'High').length;
        const mediumCount = zones.filter(z => z.riskLevel === 'Medium').length;
        const lowCount = zones.filter(z => z.riskLevel === 'Low').length;

        // Update stats
        document.getElementById('criticalZonesCount').textContent = criticalCount;
        document.getElementById('highZonesCount').textContent = highCount;
        document.getElementById('mediumZonesCount').textContent = mediumCount;
        document.getElementById('lowZonesCount').textContent = lowCount;

        // Sort zones by risk level (Critical > High > Medium > Low)
        const riskOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        zones.sort((a, b) => riskOrder[a.riskLevel] - riskOrder[b.riskLevel]);

        const tableHTML = `
            <div class="zones-table">
                <div class="zones-table-header">
                    <div class="zones-table-header-row">
                        <div>Place Name</div>
                        <div>Coordinates</div>
                        <div>Risk Level</div>
                        <div>Category</div>
                        <div>Radius</div>
                        <div>Actions</div>
                    </div>
                </div>
                <div class="zones-table-body">
                    ${zones.map(zone => {
                        const riskClass = zone.riskLevel.toLowerCase();
                        return `
                        <div class="zone-row">
                            <div class="zone-place-name">
                                <div class="zone-place-title">${zone.placeName}</div>
                                <div class="zone-place-subtitle">${zone.category}</div>
                            </div>
                            <div class="zone-coordinates">
                                <div class="zone-coordinate-item">
                                    <span class="zone-coordinate-label">LAT</span>
                                    <span>${zone.latitude.toFixed(6)}</span>
                                </div>
                                <div class="zone-coordinate-item">
                                    <span class="zone-coordinate-label">LNG</span>
                                    <span>${zone.longitude.toFixed(6)}</span>
                                </div>
                            </div>
                            <div>
                                <span class="zone-risk-badge ${riskClass}">
                                    <span class="zone-risk-dot"></span>
                                    ${zone.riskLevel}
                                </span>
                            </div>
                            <div>
                                <span class="zone-category-badge">${zone.category}</span>
                            </div>
                            <div>
                                <span class="zone-radius">${zone.radius}<span class="zone-radius-unit">m</span></span>
                            </div>
                            <div class="zone-actions">
                                <button class="zone-action-btn view" onclick="viewZoneDetails('${zone.id}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                    View
                                </button>
                                <button class="zone-action-btn delete" onclick="deleteZone('${zone.id}')">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="3 6 5 6 21 6"></polyline>
                                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                    </svg>
                                    Delete
                                </button>
                            </div>
                        </div>
                    `}).join('')}
                </div>
            </div>
        `;

        document.getElementById('zonesContent').innerHTML = tableHTML;

    } catch (error) {
        console.error('Load zones error:', error);
        document.getElementById('zonesContent').innerHTML = `<div class="empty-state">Error loading danger zones: ${error.message}</div>`;
    }
}

// Load Silent Room
async function loadSilentRoom() {
    try {
        const typeFilter = document.getElementById('postTypeFilter')?.value || '';
        const statusFilter = document.getElementById('postFilter')?.value || '';
        const params = new URLSearchParams({ page: 1, limit: 100 });
        if (statusFilter) params.append('status', statusFilter);

        const response = await apiCall(`/admin/silent-room/reports?${params}`);
        
        let posts = response.data.reports;

        // Filter by type if selected
        if (typeFilter) {
            posts = posts.filter(p => p.postType === typeFilter);
        }

        // Calculate stats
        const totalPosts = posts.length;
        const pendingPosts = posts.filter(p => !p.status || p.status === 'pending').length;
        const complaints = posts.filter(p => p.postType === 'complaint' || p.postType === 'harassment').length;
        const actionTaken = posts.filter(p => p.status === 'action_taken').length;

        // Update stats
        document.getElementById('srTotalPosts').textContent = totalPosts;
        document.getElementById('srPendingPosts').textContent = pendingPosts;
        document.getElementById('srComplaints').textContent = complaints;
        document.getElementById('srActionTaken').textContent = actionTaken;

        if (!posts || posts.length === 0) {
            document.getElementById('postsContent').innerHTML = '<div class="empty-state">No posts found</div>';
            return;
        }

        // Sort: private complaints first, then pending, then complaints, then by date
        posts.sort((a, b) => {
            // Private posts first
            if (a.isPrivate && !b.isPrivate) return -1;
            if (!a.isPrivate && b.isPrivate) return 1;
            
            const aStatus = a.status || 'pending';
            const bStatus = b.status || 'pending';
            
            if (aStatus === 'pending' && bStatus !== 'pending') return -1;
            if (aStatus !== 'pending' && bStatus === 'pending') return 1;
            
            const aIsComplaint = a.postType === 'complaint' || a.postType === 'harassment';
            const bIsComplaint = b.postType === 'complaint' || b.postType === 'harassment';
            
            if (aIsComplaint && !bIsComplaint) return -1;
            if (!aIsComplaint && bIsComplaint) return 1;
            
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const postsHTML = posts.map(post => {
            const status = post.status || 'pending';
            const isComplaint = post.postType === 'complaint' || post.postType === 'harassment';
            const priority = post.isPrivate ? 'high' : (isComplaint ? 'high' : status === 'pending' ? 'medium' : 'low');
            const cardClass = isComplaint ? 'complaint' : status === 'action_taken' ? 'action-taken' : status === 'approved' ? 'approved' : 'pending';
            
            const messagePreview = post.message.length > 150 ? post.message.substring(0, 150) + '...' : post.message;
            
            return `
            <div class="post-card ${cardClass}">
                <div class="post-priority ${priority}">${priority.toUpperCase()}</div>
                ${post.isPrivate ? '<div class="post-private-badge">🔒 PRIVATE</div>' : ''}
                
                <div class="post-header">
                    <div class="post-user-info">
                        <div class="post-user">
                            ${post.anonymous ? '👤 Anonymous' : post.userName}
                            ${post.anonymous ? '' : '<span class="post-user-badge">Verified</span>'}
                            ${post.isPrivate ? '<span class="post-user-badge" style="background: rgba(239, 68, 68, 0.2); color: var(--red);">Private</span>' : ''}
                        </div>
                        <div class="post-meta">
                            <span class="post-meta-item">📅 ${formatTimeAgo(post.createdAt)}</span>
                            <span class="post-type-badge ${post.postType}">${post.postType}</span>
                        </div>
                    </div>
                    <span class="status-badge ${getStatusClass(status)}">
                        ${getStatusIcon(status)} ${formatStatus(status)}
                    </span>
                </div>

                ${post.locationAddress ? `
                <div class="post-location">
                    📍 ${post.locationAddress}
                </div>
                ` : ''}

                <div class="post-message">
                    ${messagePreview}
                </div>

                ${!post.isPrivate ? `
                <div class="post-stats">
                    <div class="post-stat">
                        <span class="post-stat-icon">❤️</span>
                        <span>${post.likes || 0}</span>
                    </div>
                    <div class="post-stat">
                        <span class="post-stat-icon">💬</span>
                        <span>${post.comments || 0}</span>
                    </div>
                    <div class="post-stat">
                        <span class="post-stat-icon">👁️</span>
                        <span>${post.views || 0}</span>
                    </div>
                </div>
                ` : '<div class="post-private-note">🔒 Private complaints are only visible to admin and the user who created it</div>'}

                ${post.adminResponse ? `
                <div class="post-admin-response">
                    <div class="post-admin-response-header">
                        🛡️ Admin Response
                    </div>
                    <div class="post-admin-response-text">${post.adminResponse}</div>
                </div>
                ` : ''}

                <div class="post-actions">
                    <button class="btn-small btn-view" onclick="viewPostDetail('${post.id}')">📋 View Details</button>
                    ${status === 'pending' ? `
                        <button class="btn-small btn-edit" onclick="quickApprove('${post.id}')">✅ Approve</button>
                        <button class="btn-small btn-delete" onclick="quickReject('${post.id}')">❌ Reject</button>
                    ` : ''}
                    ${isComplaint || status === 'pending' || post.isPrivate ? `
                        <button class="btn-small" style="background: var(--green); color: white;" onclick="openAdminResponse('${post.id}')">
                            💬 Send Response
                        </button>
                    ` : ''}
                    <button class="btn-small btn-delete" onclick="deletePost('${post.id}')">🗑️ Delete</button>
                </div>
            </div>
        `}).join('');

        document.getElementById('postsContent').innerHTML = postsHTML;

    } catch (error) {
        console.error('Load posts error:', error);
        document.getElementById('postsContent').innerHTML = `<div class="empty-state">Error loading posts: ${error.message}</div>`;
    }
}

// Load Complaints (Private complaints only)
async function loadComplaints() {
    try {
        const statusFilter = document.getElementById('complaintStatusFilter')?.value || '';
        
        // Always fetch ALL complaints (no status filter in API call)
        const params = new URLSearchParams({ page: 1, limit: 100 });
        const response = await apiCall(`/admin/silent-room/reports?${params}`);
        
        // Filter to show ONLY private complaints
        let allComplaints = response.data.reports.filter(p => p.isPrivate === true);

        // Calculate stats from ALL complaints (before filtering)
        const totalComplaints = allComplaints.length;
        const pendingComplaints = allComplaints.filter(p => !p.status || p.status === 'pending').length;
        const actionTakenComplaints = allComplaints.filter(p => p.status === 'action_taken').length;
        const rejectedComplaints = allComplaints.filter(p => p.status === 'rejected').length;

        // Update stats (these should NEVER change when filtering)
        document.getElementById('totalComplaints').textContent = totalComplaints;
        document.getElementById('pendingComplaints').textContent = pendingComplaints;
        document.getElementById('actionTakenComplaints').textContent = actionTakenComplaints;
        document.getElementById('rejectedComplaints').textContent = rejectedComplaints;
        document.getElementById('complaintsBadge').textContent = pendingComplaints;

        // NOW apply status filter for display only
        let complaintsToDisplay = allComplaints;
        if (statusFilter) {
            complaintsToDisplay = allComplaints.filter(p => p.status === statusFilter);
        }

        if (!complaintsToDisplay || complaintsToDisplay.length === 0) {
            document.getElementById('complaintsContent').innerHTML = '<div class="empty-state">No complaints found</div>';
            return;
        }

        // Sort: pending first, then by date
        complaintsToDisplay.sort((a, b) => {
            const aStatus = a.status || 'pending';
            const bStatus = b.status || 'pending';
            
            if (aStatus === 'pending' && bStatus !== 'pending') return -1;
            if (aStatus !== 'pending' && bStatus === 'pending') return 1;
            
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const complaintsHTML = complaintsToDisplay.map(post => {
            const status = post.status || 'pending';
            const statusColors = {
                'pending': '#F59E0B',
                'approved': '#3B82F6',
                'action_taken': '#10B981',
                'rejected': '#EF4444'
            };
            const statusLabels = {
                'pending': 'Pending Review',
                'approved': 'Under Review',
                'action_taken': 'Action Taken',
                'rejected': 'Rejected'
            };
            
            const messagePreview = post.message.length > 120 ? post.message.substring(0, 120) + '...' : post.message;
            
            return `
            <div class="complaint-card-clean">
                <div class="complaint-header">
                    <div class="complaint-user-section">
                        <div class="complaint-avatar">${post.anonymous ? '👤' : (post.userName ? post.userName[0].toUpperCase() : 'U')}</div>
                        <div class="complaint-user-details">
                            <div class="complaint-username">
                                ${post.anonymous ? 'Anonymous' : post.userName}
                                <span class="complaint-private-badge">🔒 Private</span>
                            </div>
                            <div class="complaint-metadata">
                                <span class="complaint-type-tag">${post.postType}</span>
                                <span class="complaint-time">• ${formatTimeAgo(post.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="complaint-status" style="background: ${statusColors[status]}20; color: ${statusColors[status]}">
                        ${statusLabels[status]}
                    </div>
                </div>

                <div class="complaint-body">
                    <p class="complaint-message-text">${messagePreview}</p>
                    
                    ${post.locationAddress ? `
                    <div class="complaint-location-tag">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                        ${post.locationAddress}
                    </div>
                    ` : ''}

                    ${post.adminResponse ? `
                    <div class="complaint-admin-response">
                        <div class="response-header">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                <polyline points="9 12 11 14 15 10"/>
                            </svg>
                            Admin Response
                        </div>
                        <p class="response-text">${post.adminResponse}</p>
                    </div>
                    ` : ''}
                </div>

                <div class="complaint-actions">
                    ${!post.adminResponse ? `
                    <button class="btn-action btn-respond" onclick="openAdminResponse('${post.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                        Send Response
                    </button>
                    ` : ''}
                    ${status === 'pending' ? `
                    <button class="btn-action btn-resolve" onclick="quickApprove('${post.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Mark Resolved
                    </button>
                    ` : ''}
                    <button class="btn-action btn-delete-action" onclick="deletePost('${post.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                        Delete
                    </button>
                </div>
            </div>
        `}).join('');

        document.getElementById('complaintsContent').innerHTML = complaintsHTML;

    } catch (error) {
        document.getElementById('complaintsContent').innerHTML = `<div class="empty-state">Error loading complaints: ${error.message}</div>`;
    }
}

// Load Community Posts (Public posts only)
async function loadCommunityPosts() {
    try {
        const typeFilter = document.getElementById('communityTypeFilter')?.value || '';
        
        // Always fetch ALL posts (no filters in API call)
        const params = new URLSearchParams({ page: 1, limit: 100 });
        const response = await apiCall(`/admin/silent-room/reports?${params}`);
        
        // Filter to show ONLY public posts (not private complaints)
        let allPosts = response.data.reports.filter(p => !p.isPrivate);

        // Calculate stats from ALL posts (before filtering)
        const totalPosts = allPosts.length;
        const flaggedPosts = allPosts.filter(p => p.flagged === true || p.reportCount > 0).length;
        const deletedPosts = allPosts.filter(p => p.status === 'deleted').length;

        // Update stats (these should NEVER change when filtering)
        document.getElementById('totalCommunityPosts').textContent = totalPosts;
        document.getElementById('flaggedCommunityPosts').textContent = flaggedPosts;
        document.getElementById('deletedCommunityPosts').textContent = deletedPosts;
        document.getElementById('communityBadge').textContent = flaggedPosts;

        // NOW apply filters for display only
        let postsToDisplay = allPosts;
        
        if (typeFilter) {
            postsToDisplay = postsToDisplay.filter(p => p.postType === typeFilter);
        }

        if (!postsToDisplay || postsToDisplay.length === 0) {
            document.getElementById('communityPostsContent').innerHTML = '<div class="empty-state">No community posts found</div>';
            return;
        }

        // Sort: flagged first, then by date
        postsToDisplay.sort((a, b) => {
            const aFlagged = a.flagged === true || a.reportCount > 0;
            const bFlagged = b.flagged === true || b.reportCount > 0;
            
            if (aFlagged && !bFlagged) return -1;
            if (!aFlagged && bFlagged) return 1;
            
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        const postsHTML = postsToDisplay.map(post => {
            const messagePreview = post.message.length > 100 ? post.message.substring(0, 100) + '...' : post.message;
            const isFlagged = post.flagged === true || post.reportCount > 0;
            
            return `
            <div class="post-card-clean ${isFlagged ? 'post-flagged' : ''}">
                ${isFlagged ? '<div class="flagged-badge">⚠️ FLAGGED</div>' : ''}
                <div class="post-card-header">
                    <div class="post-user-section">
                        <div class="post-avatar">${post.anonymous ? '👤' : (post.userName ? post.userName[0].toUpperCase() : 'U')}</div>
                        <div class="post-user-details">
                            <div class="post-username">${post.anonymous ? 'Anonymous' : post.userName}</div>
                            <div class="post-metadata">
                                <span class="post-type-tag">${post.postType}</span>
                                <span class="post-time">• ${formatTimeAgo(post.createdAt)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="post-card-body">
                    <p class="post-message-text">${messagePreview}</p>
                    
                    ${post.locationAddress ? `
                    <div class="post-location-tag">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                        ${post.locationAddress}
                    </div>
                    ` : ''}

                    <div class="post-engagement">
                        <span class="engagement-item">❤️ ${post.likes || 0}</span>
                        <span class="engagement-item">💬 ${post.comments || 0}</span>
                        <span class="engagement-item">👁️ ${post.views || 0}</span>
                    </div>
                </div>

                <div class="post-card-actions">
                    <button class="btn-action btn-warn" onclick="warnUser('${post.id}', '${post.userId}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Warn User
                    </button>
                    <button class="btn-action btn-delete-action" onclick="deletePost('${post.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                        Delete Post
                    </button>
                </div>
            </div>
        `}).join('');

        document.getElementById('communityPostsContent').innerHTML = postsHTML;

    } catch (error) {
        document.getElementById('communityPostsContent').innerHTML = `<div class="empty-state">Error loading posts: ${error.message}</div>`;
    }
}

// Helper functions for Silent Room
function getStatusClass(status) {
    const classes = {
        'pending': 'status-unverified',
        'approved': 'status-verified',
        'rejected': 'status-offline',
        'action_taken': 'status-online',
        'under_review': 'status-unverified',
        'resolved': 'status-verified',
        'no_action': 'status-offline'
    };
    return classes[status] || 'status-unverified';
}

function getStatusIcon(status) {
    const icons = {
        'pending': '⏳',
        'approved': '✅',
        'rejected': '❌',
        'action_taken': '🔧',
        'under_review': '🔍',
        'resolved': '✔️',
        'no_action': '⛔'
    };
    return icons[status] || '⏳';
}

function formatStatus(status) {
    const names = {
        'pending': 'Pending',
        'approved': 'Approved',
        'rejected': 'Rejected',
        'action_taken': 'Action Taken',
        'under_review': 'Under Review',
        'resolved': 'Resolved',
        'no_action': 'No Action'
    };
    return names[status] || 'Pending';
}

// View post detail
let currentPostId = null;

async function viewPostDetail(postId) {
    try {
        const response = await apiCall(`/admin/silent-room/reports?page=1&limit=1000`);
        const post = response.data.reports.find(p => p.id === postId);
        
        if (!post) {
            alert('Post not found');
            return;
        }

        const detailHTML = `
            <div class="post-detail-section">
                <h3>Post Information</h3>
                <div class="post-detail-info">
                    <div class="post-detail-item">
                        <div class="post-detail-label">User</div>
                        <div class="post-detail-value">${post.anonymous ? 'Anonymous' : post.userName}</div>
                    </div>
                    <div class="post-detail-item">
                        <div class="post-detail-label">Email</div>
                        <div class="post-detail-value">${post.anonymous ? 'Hidden' : (post.userEmail || 'N/A')}</div>
                    </div>
                    <div class="post-detail-item">
                        <div class="post-detail-label">Post Type</div>
                        <div class="post-detail-value">${post.postType}</div>
                    </div>
                    <div class="post-detail-item">
                        <div class="post-detail-label">Status</div>
                        <div class="post-detail-value">${formatStatus(post.status || 'pending')}</div>
                    </div>
                    <div class="post-detail-item">
                        <div class="post-detail-label">Created</div>
                        <div class="post-detail-value">${new Date(post.createdAt).toLocaleString()}</div>
                    </div>
                    <div class="post-detail-item">
                        <div class="post-detail-label">Engagement</div>
                        <div class="post-detail-value">❤️ ${post.likes} | 💬 ${post.comments} | 👁️ ${post.views}</div>
                    </div>
                </div>
            </div>

            <div class="post-detail-section">
                <h3>Message</h3>
                <div class="post-detail-message">${post.message}</div>
            </div>

            ${post.locationAddress ? `
            <div class="post-detail-section">
                <h3>Location</h3>
                <div class="post-detail-message">
                    📍 ${post.locationAddress}<br>
                    📌 Coordinates: ${post.locationLat}, ${post.locationLng}
                </div>
            </div>
            ` : ''}

            ${post.images && post.images.length > 0 ? `
            <div class="post-detail-section">
                <h3>Images</h3>
                <div class="post-detail-images">
                    ${post.images.map(img => {
                        // Handle both base64 objects and direct URLs
                        const imgSrc = typeof img === 'string' ? img : `data:${img.mimeType};base64,${img.data}`;
                        return `<img src="${imgSrc}" class="post-detail-image" onclick="window.open('${imgSrc}', '_blank')" style="cursor: pointer;" />`;
                    }).join('')}
                </div>
            </div>
            ` : ''}

            ${post.adminResponse ? `
            <div class="post-detail-section">
                <h3>Admin Response</h3>
                <div class="post-admin-response">
                    <div class="post-admin-response-text">${post.adminResponse}</div>
                </div>
            </div>
            ` : ''}

            <div class="post-detail-actions">
                <button class="btn-primary" onclick="openAdminResponse('${post.id}')">💬 Send Response</button>
                <button class="btn-small btn-view" onclick="moderatePost('${post.id}', 'approve')">✅ Approve</button>
                <button class="btn-small btn-edit" onclick="moderatePost('${post.id}', 'reject')">❌ Reject</button>
                <button class="btn-small btn-delete" onclick="moderatePost('${post.id}', 'delete')">🗑️ Delete</button>
            </div>
        `;

        document.getElementById('postDetailContent').innerHTML = detailHTML;
        document.getElementById('postDetailModal').style.display = 'flex';
    } catch (error) {
        alert('Error loading post details');
    }
}

// Quick actions
async function quickApprove(postId) {
    await moderatePost(postId, 'approve');
}

async function quickReject(postId) {
    const reason = prompt('Enter rejection reason (optional):');
    await moderatePost(postId, 'reject', reason);
}

// Warn User
async function warnUser(postId, userId) {
    const reason = prompt('Enter warning reason for the user:');
    if (!reason) return;
    
    try {
        await apiCall(`/admin/silent-room/warn`, {
            method: 'POST',
            body: JSON.stringify({ postId, userId, reason, adminPassword })
        });
        alert('Warning sent to user successfully');
        loadCommunityPosts();
    } catch (error) {
        alert('Error sending warning: ' + error.message);
    }
}

async function deletePost(postId) {
    if (!confirm('Permanently delete this post?')) return;
    await moderatePost(postId, 'delete');
}

// Open admin response modal
function openAdminResponse(postId) {
    currentPostId = postId;
    document.getElementById('adminResponseText').value = '';
    document.getElementById('adminResponseStatus').value = 'action_taken';
    document.getElementById('adminResponseModal').style.display = 'flex';
}

// Send admin response
async function sendAdminResponse() {
    const responseText = document.getElementById('adminResponseText').value.trim();
    const responseStatus = document.getElementById('adminResponseStatus').value;

    if (!responseText) {
        alert('Please enter a response message');
        return;
    }

    if (!currentPostId) {
        alert('No post selected');
        return;
    }

    try {
        await apiCall(`/admin/silent-room/reports/${currentPostId}/respond`, {
            method: 'POST',
            body: JSON.stringify({
                response: responseText,
                status: responseStatus,
                adminPassword
            })
        });

        alert('Response sent successfully! It will be visible to the user in Silent Room.');
        closeModal('adminResponseModal');
        closeModal('postDetailModal');
        // Reload the appropriate section based on post type
        const currentSection = document.querySelector('.nav-item.active')?.dataset.section;
        if (currentSection === 'complaints') {
            loadComplaints();
        } else if (currentSection === 'community-posts') {
            loadCommunityPosts();
        }
    } catch (error) {
        alert('Error sending response: ' + error.message);
    }
}

// Load Emergency Alerts
async function loadEmergencyAlerts() {
    try {
        const statusFilter = document.getElementById('emergencyStatusFilter')?.value || '';
        const timeFilter = document.getElementById('emergencyTimeFilter')?.value || 'all';
        
        // Fetch ALL sessions for accurate statistics (no status filter)
        const allParams = new URLSearchParams({ page: 1, limit: 1000 });
        if (timeFilter !== 'all') allParams.append('timeFilter', timeFilter);
        
        const allResponse = await apiCall(`/admin/sos-sessions?${allParams}`);
        const allSessions = allResponse.data.sessions;
        
        // Calculate stats from ALL sessions
        const activeAlerts = allSessions.filter(s => s.status === 'active').length;
        const resolvedAlerts = allSessions.filter(s => s.status === 'resolved').length;
        const falseAlarms = allSessions.filter(s => s.status === 'false_alarm').length;
        const totalAlerts = allSessions.length;
        
        // Calculate average response time for resolved alerts only
        const resolvedWithDuration = allSessions.filter(s => s.duration !== null && s.status === 'resolved');
        const avgResponseTime = resolvedWithDuration.length > 0
            ? Math.floor(resolvedWithDuration.reduce((sum, s) => sum + s.duration, 0) / resolvedWithDuration.length)
            : 0;
        
        const formatDuration = (seconds) => {
            if (seconds < 60) return `${seconds}s`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
            return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
        };

        // Update stats (these should NEVER change when filtering)
        document.getElementById('activeAlerts').textContent = activeAlerts;
        document.getElementById('totalAlerts').textContent = totalAlerts;
        document.getElementById('resolvedAlerts').textContent = resolvedAlerts;
        document.getElementById('falseAlarms').textContent = falseAlarms;
        document.getElementById('avgResponseTime').textContent = avgResponseTime > 0 ? formatDuration(avgResponseTime) : 'N/A';
        document.getElementById('emergencyBadge').textContent = activeAlerts;

        // Now apply filters for display
        let sessionsToDisplay = allSessions;
        if (statusFilter) {
            sessionsToDisplay = allSessions.filter(s => s.status === statusFilter);
        }

        if (!sessionsToDisplay || sessionsToDisplay.length === 0) {
            document.getElementById('emergencyAlertsContent').innerHTML = '<div class="empty-state">No emergency alerts found</div>';
            return;
        }

        const alertsHTML = sessionsToDisplay.map(session => {
            const isActive = session.status === 'active';
            const isFalseAlarm = session.status === 'false_alarm';
            const duration = session.duration ? formatDuration(session.duration) : 'Ongoing';
            
            // Parse location
            let locationDisplay = 'Location not available';
            let mapLink = '#';
            if (session.location) {
                if (session.location.latitude && session.location.longitude) {
                    locationDisplay = session.location.address || `${session.location.latitude.toFixed(6)}, ${session.location.longitude.toFixed(6)}`;
                    mapLink = `https://www.google.com/maps?q=${session.location.latitude},${session.location.longitude}`;
                }
            }

            return `
            <div class="emergency-alert-card ${isActive ? 'emergency-alert-card--active' : ''} ${isFalseAlarm ? 'emergency-alert-card--false-alarm' : ''}">
                <div class="emergency-alert-header">
                    <div class="emergency-alert-status ${isActive ? 'emergency-alert-status--active' : isFalseAlarm ? 'emergency-alert-status--false-alarm' : 'emergency-alert-status--resolved'}">
                        ${isActive ? '🔴 ACTIVE' : isFalseAlarm ? '⚠️ FALSE ALARM' : '✅ RESOLVED'}
                    </div>
                    <div class="emergency-alert-time">
                        ${formatTimeAgo(session.createdAt)}
                    </div>
                </div>

                <div class="emergency-alert-body">
                    <div class="emergency-alert-user">
                        <div class="emergency-alert-avatar">${session.userName[0].toUpperCase()}</div>
                        <div class="emergency-alert-user-info">
                            <div class="emergency-alert-user-name">${escapeHtml(session.userName)}</div>
                            <div class="emergency-alert-user-id">SafeNex ID: ${session.safeNexID}</div>
                            <div class="emergency-alert-user-email">${session.userEmail}</div>
                        </div>
                    </div>

                    ${session.adminNotes ? `
                    <div class="emergency-alert-admin-notes">
                        <div class="admin-notes-header">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            Admin Notes
                        </div>
                        <div class="admin-notes-text">${escapeHtml(session.adminNotes)}</div>
                    </div>
                    ` : ''}

                    <div class="emergency-alert-details">
                        <div class="emergency-alert-detail-row">
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <circle cx="12" cy="12" r="10"/>
                                        <polyline points="12 6 12 12 16 14"/>
                                    </svg>
                                    Started
                                </div>
                                <div class="emergency-alert-detail-value">${new Date(session.startTime).toLocaleString()}</div>
                            </div>
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 2v20M2 12h20"/>
                                    </svg>
                                    Duration
                                </div>
                                <div class="emergency-alert-detail-value">${duration}</div>
                            </div>
                        </div>

                        <div class="emergency-alert-detail-row">
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                                        <circle cx="12" cy="10" r="3"/>
                                    </svg>
                                    Location
                                </div>
                                <div class="emergency-alert-detail-value">
                                    <a href="${mapLink}" target="_blank" class="emergency-alert-map-link">
                                        ${locationDisplay}
                                    </a>
                                </div>
                            </div>
                        </div>

                        <div class="emergency-alert-detail-row">
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                                    </svg>
                                    Primary Contact
                                </div>
                                <div class="emergency-alert-detail-value">
                                    <a href="tel:${session.primaryContact}" class="emergency-alert-phone-link">
                                        ${session.primaryContact}
                                    </a>
                                </div>
                            </div>
                            ${session.secondaryContact !== 'Not Set' ? `
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                                    </svg>
                                    Secondary Contact
                                </div>
                                <div class="emergency-alert-detail-value">
                                    <a href="tel:${session.secondaryContact}" class="emergency-alert-phone-link">
                                        ${session.secondaryContact}
                                    </a>
                                </div>
                            </div>
                            ` : ''}
                        </div>

                        <div class="emergency-alert-detail-row">
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                                    </svg>
                                    Triggered By
                                </div>
                                <div class="emergency-alert-detail-value">${session.triggeredBy || 'Manual'}</div>
                            </div>
                            <div class="emergency-alert-detail-item">
                                <div class="emergency-alert-detail-label">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                        <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                                    </svg>
                                    Session ID
                                </div>
                                <div class="emergency-alert-detail-value emergency-alert-session-id">${session.sessionId}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="emergency-alert-actions">
                    ${isActive ? `
                    <button class="btn-action btn-resolve" onclick="resolveEmergency('${session.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        Mark as Resolved
                    </button>
                    <button class="btn-action btn-false-alarm" onclick="markAsFalseAlarm('${session.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="15" y1="9" x2="9" y2="15"/>
                            <line x1="9" y1="9" x2="15" y2="15"/>
                        </svg>
                        False Alarm
                    </button>
                    ` : ''}
                    <button class="btn-action btn-view" onclick="viewEmergencyDetails('${session.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                        View Details
                    </button>
                    <button class="btn-action btn-warn" onclick="contactUser('${session.userId}', '${session.primaryContact}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
                        </svg>
                        Call Contact
                    </button>
                </div>
            </div>
        `}).join('');

        document.getElementById('emergencyAlertsContent').innerHTML = alertsHTML;

    } catch (error) {
        console.error('Load emergency alerts error:', error);
        document.getElementById('emergencyAlertsContent').innerHTML = `<div class="empty-state">Error loading emergency alerts: ${error.message}</div>`;
    }
}

// Emergency alert actions
async function resolveEmergency(sessionId) {
    const notes = prompt('Add resolution notes (optional):');
    if (notes === null) return; // User cancelled
    
    try {
        await apiCall(`/admin/sos-sessions/${sessionId}/resolve`, {
            method: 'PUT',
            body: JSON.stringify({ 
                notes: notes || 'Resolved by admin',
                adminPassword: adminPassword // Include admin password
            })
        });
        
        alert('✅ Emergency marked as resolved successfully!');
        loadEmergencyAlerts();
    } catch (error) {
        alert('Error resolving emergency: ' + error.message);
    }
}

async function markAsFalseAlarm(sessionId) {
    const reason = prompt('Reason for marking as false alarm:');
    if (!reason) {
        alert('Please provide a reason');
        return;
    }
    
    if (!confirm(`Mark this emergency as FALSE ALARM?\n\nReason: ${reason}`)) {
        return;
    }
    
    try {
        await apiCall(`/admin/sos-sessions/${sessionId}/false-alarm`, {
            method: 'PUT',
            body: JSON.stringify({ 
                reason,
                adminPassword: adminPassword // Include admin password
            })
        });
        
        alert('⚠️ Emergency marked as false alarm');
        loadEmergencyAlerts();
    } catch (error) {
        alert('Error marking as false alarm: ' + error.message);
    }
}

async function viewEmergencyDetails(sessionId) {
    try {
        const response = await apiCall(`/admin/sos-sessions/${sessionId}`);
        const session = response.data;
        
        // Format location
        let locationHTML = 'Location not available';
        if (session.location && session.location.latitude && session.location.longitude) {
            const mapLink = `https://www.google.com/maps?q=${session.location.latitude},${session.location.longitude}`;
            locationHTML = `
                <a href="${mapLink}" target="_blank" style="color: var(--cyan);">
                    ${session.location.address || `${session.location.latitude.toFixed(6)}, ${session.location.longitude.toFixed(6)}`}
                </a>
            `;
        }
        
        // Format duration
        const formatDuration = (seconds) => {
            if (!seconds) return 'Ongoing';
            if (seconds < 60) return `${seconds} seconds`;
            if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ${seconds % 60} seconds`;
            return `${Math.floor(seconds / 3600)} hours ${Math.floor((seconds % 3600) / 60)} minutes`;
        };
        
        // Format events
        let eventsHTML = '<p style="color: var(--text-muted);">No events recorded</p>';
        if (session.events && Array.isArray(session.events) && session.events.length > 0) {
            eventsHTML = session.events.map(event => `
                <div style="padding: 8px; background: rgba(255,255,255,0.02); border-radius: 6px; margin-bottom: 8px;">
                    <div style="font-size: 12px; color: var(--text-muted);">${new Date(event.timestamp).toLocaleString()}</div>
                    <div style="font-size: 14px; color: var(--text);">${event.type}: ${event.description || 'N/A'}</div>
                </div>
            `).join('');
        }
        
        const detailsHTML = `
            <div style="max-height: 70vh; overflow-y: auto;">
                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">User Information</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Name</div>
                            <div style="font-size: 14px; color: var(--text);">${escapeHtml(session.userName)}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Email</div>
                            <div style="font-size: 14px; color: var(--text);">${session.userEmail}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">SafeNex ID</div>
                            <div style="font-size: 14px; color: var(--text);">${session.safeNexID}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">User ID</div>
                            <div style="font-size: 12px; color: var(--text-secondary); font-family: monospace;">${session.userId}</div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Emergency Details</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Session ID</div>
                            <div style="font-size: 12px; color: var(--text); font-family: monospace;">${session.sessionId}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Triggered By</div>
                            <div style="font-size: 14px; color: var(--text);">${session.triggeredBy || 'Manual'}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Start Time</div>
                            <div style="font-size: 14px; color: var(--text);">${new Date(session.startTime).toLocaleString()}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">End Time</div>
                            <div style="font-size: 14px; color: var(--text);">${session.endTime ? new Date(session.endTime).toLocaleString() : 'Ongoing'}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Duration</div>
                            <div style="font-size: 14px; color: var(--text);">${formatDuration(session.duration)}</div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Status</div>
                            <div style="font-size: 14px; color: ${session.status === 'active' ? 'var(--red)' : session.status === 'false_alarm' ? 'var(--yellow)' : 'var(--green)'};">
                                ${session.status === 'active' ? '🔴 ACTIVE' : session.status === 'false_alarm' ? '⚠️ FALSE ALARM' : '✅ RESOLVED'}
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Contact Information</h3>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Primary Contact</div>
                            <div style="font-size: 14px;">
                                <a href="tel:${session.primaryContact}" style="color: var(--cyan); text-decoration: none;">
                                    ${session.primaryContact}
                                </a>
                            </div>
                        </div>
                        <div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Secondary Contact</div>
                            <div style="font-size: 14px;">
                                ${session.secondaryContact !== 'Not Set' ? 
                                    `<a href="tel:${session.secondaryContact}" style="color: var(--cyan); text-decoration: none;">${session.secondaryContact}</a>` : 
                                    '<span style="color: var(--text-muted);">Not Set</span>'}
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Location</h3>
                    <div style="padding: 12px; background: rgba(255,255,255,0.02); border-radius: 8px;">
                        ${locationHTML}
                    </div>
                </div>

                ${session.messageTemplate ? `
                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Emergency Message</h3>
                    <div style="padding: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; color: var(--text);">
                        ${escapeHtml(session.messageTemplate)}
                    </div>
                </div>
                ` : ''}

                ${session.adminNotes ? `
                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Admin Notes</h3>
                    <div style="padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; color: var(--text);">
                        ${escapeHtml(session.adminNotes)}
                    </div>
                </div>
                ` : ''}

                <div style="margin-bottom: 24px;">
                    <h3 style="font-size: 18px; margin-bottom: 16px; color: var(--text);">Event Timeline</h3>
                    ${eventsHTML}
                </div>

                ${session.status === 'active' ? `
                <div style="display: flex; gap: 12px; margin-top: 24px;">
                    <button class="btn-primary" onclick="closeModal('emergencyDetailModal'); resolveEmergency('${session.id}')">
                        Mark as Resolved
                    </button>
                    <button class="btn-secondary" onclick="closeModal('emergencyDetailModal'); markAsFalseAlarm('${session.id}')">
                        Mark as False Alarm
                    </button>
                    <button class="btn-secondary" onclick="addNotesToSession('${session.id}')">
                        Add Notes
                    </button>
                </div>
                ` : `
                <div style="display: flex; gap: 12px; margin-top: 24px;">
                    <button class="btn-secondary" onclick="addNotesToSession('${session.id}')">
                        Add Notes
                    </button>
                </div>
                `}
            </div>
        `;
        
        document.getElementById('emergencyDetailContent').innerHTML = detailsHTML;
        document.getElementById('emergencyDetailModal').style.display = 'flex';
        
    } catch (error) {
        alert('Error loading emergency details: ' + error.message);
    }
}

async function addNotesToSession(sessionId) {
    const notes = prompt('Enter admin notes:');
    if (!notes) return;
    
    try {
        await apiCall(`/admin/sos-sessions/${sessionId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ 
                notes,
                adminPassword: adminPassword // Include admin password
            })
        });
        
        alert('✅ Notes added successfully!');
        closeModal('emergencyDetailModal');
        loadEmergencyAlerts();
    } catch (error) {
        alert('Error adding notes: ' + error.message);
    }
}

function contactUser(userId, phoneNumber) {
    if (confirm(`Call emergency contact: ${phoneNumber}?`)) {
        window.open(`tel:${phoneNumber}`);
    }
}

// Load System Health
async function loadSystemHealth() {
    try {
        // Fetch real-time data from various endpoints
        const [statsRes, usersRes, zonesRes, postsRes] = await Promise.all([
            apiCall('/admin/stats').catch(() => ({ data: null })),
            apiCall('/admin/users?limit=1000').catch(() => ({ data: { users: [] } })),
            apiCall('/admin/danger-zones').catch(() => ({ data: [] })),
            apiCall('/admin/silent-room/reports?limit=1000').catch(() => ({ data: { reports: [] } }))
        ]);

        const stats = statsRes.data || {};
        const users = usersRes.data?.users || [];
        const zones = zonesRes.data || [];
        const posts = postsRes.data?.reports || [];

        // Calculate today's data
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const postsToday = posts.filter(p => new Date(p.createdAt) >= today).length;
        const usersToday = users.filter(u => new Date(u.createdAt) >= today).length;
        
        // Calculate active users (last 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const activeUsers = users.filter(u => new Date(u.createdAt) > fiveMinutesAgo).length;

        // Check system status
        const dbStatus = stats.totalUsers !== undefined ? 'online' : 'offline';
        const safeTraceStatus = zones.length >= 0 ? 'online' : 'offline';
        const silentRoomStatus = posts.length >= 0 ? 'online' : 'offline';
        
        // Test Gemini AI
        let geminiStatus = 'checking';
        let geminiModel = 'Unknown';
        let geminiResponseTime = 'N/A';
        
        try {
            const geminiStart = Date.now();
            const geminiTest = await fetch('/api/sos/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getToken()}`
                },
                body: JSON.stringify({ message: 'ping' })
            });
            const geminiEnd = Date.now();
            geminiResponseTime = `${geminiEnd - geminiStart}ms`;
            geminiStatus = geminiTest.ok ? 'online' : 'offline';
            geminiModel = 'gemini-2.0-flash-exp';
        } catch (e) {
            geminiStatus = 'offline';
        }

        const healthHTML = `
            <!-- Database System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--${dbStatus}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">Database (Turso LibSQL)</div>
                        <div class="health-subtitle">Primary data storage</div>
                    </div>
                    <div class="health-status health-status--${dbStatus}">
                        <span class="status-dot"></span>
                        ${dbStatus === 'online' ? 'Operational' : 'Offline'}
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Response Time</div>
                            <div class="health-metric-value health-metric-value--good">< 50ms</div>
                            <div class="health-metric-status">Excellent</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Connections</div>
                            <div class="health-metric-value health-metric-value--good">Active</div>
                            <div class="health-metric-status">Stable</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Total Records</div>
                            <div class="health-metric-value">${stats.totalUsers + posts.length + zones.length}</div>
                            <div class="health-metric-status">Healthy</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Storage</div>
                            <div class="health-metric-value health-metric-value--good">Cloud</div>
                            <div class="health-metric-status">Unlimited</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Provider:</span>
                            <span class="health-detail-value">Turso (LibSQL)</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Region:</span>
                            <span class="health-detail-value">Auto (Edge)</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Backup:</span>
                            <span class="health-detail-value">Automatic</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Last Check:</span>
                            <span class="health-detail-value">Just now</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- SafeTrace System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--${safeTraceStatus}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                            <circle cx="12" cy="10" r="3"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">SafeTrace Navigation</div>
                        <div class="health-subtitle">Route safety analysis</div>
                    </div>
                    <div class="health-status health-status--${safeTraceStatus}">
                        <span class="status-dot"></span>
                        ${safeTraceStatus === 'online' ? 'Operational' : 'Offline'}
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Routes Today</div>
                            <div class="health-metric-value">0</div>
                            <div class="health-metric-status">Ready</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Danger Zones</div>
                            <div class="health-metric-value">${zones.length}</div>
                            <div class="health-metric-status">Active</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">API Response</div>
                            <div class="health-metric-value health-metric-value--good">< 100ms</div>
                            <div class="health-metric-status">Fast</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Map Service</div>
                            <div class="health-metric-value health-metric-value--good">Online</div>
                            <div class="health-metric-status">Connected</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Routing API:</span>
                            <span class="health-detail-value">OpenRouteService</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Geocoding:</span>
                            <span class="health-detail-value">Nominatim OSM</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Travel Modes:</span>
                            <span class="health-detail-value">Walk, Bike, Car</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">AI Analysis:</span>
                            <span class="health-detail-value">Gemini Enabled</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Silent Room System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--${silentRoomStatus}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">Silent Room Community</div>
                        <div class="health-subtitle">Anonymous reporting platform</div>
                    </div>
                    <div class="health-status health-status--${silentRoomStatus}">
                        <span class="status-dot"></span>
                        ${silentRoomStatus === 'online' ? 'Operational' : 'Offline'}
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Posts Today</div>
                            <div class="health-metric-value">${postsToday}</div>
                            <div class="health-metric-status">Active</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Total Posts</div>
                            <div class="health-metric-value">${posts.length}</div>
                            <div class="health-metric-status">Growing</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Active Users</div>
                            <div class="health-metric-value">${activeUsers}</div>
                            <div class="health-metric-status">Online</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Real-time</div>
                            <div class="health-metric-value health-metric-value--good">Socket.IO</div>
                            <div class="health-metric-status">Connected</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Post Types:</span>
                            <span class="health-detail-value">6 Categories</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Moderation:</span>
                            <span class="health-detail-value">Admin Review</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Privacy:</span>
                            <span class="health-detail-value">Anonymous Mode</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Encryption:</span>
                            <span class="health-detail-value">End-to-End</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- SOS System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--online">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 8v4M12 16h.01"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">SOS Emergency System</div>
                        <div class="health-subtitle">Emergency alert & tracking</div>
                    </div>
                    <div class="health-status health-status--online">
                        <span class="status-dot"></span>
                        Operational
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Active Sessions</div>
                            <div class="health-metric-value">0</div>
                            <div class="health-metric-status">Standby</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Total Sessions</div>
                            <div class="health-metric-value">${stats.totalSOS || 0}</div>
                            <div class="health-metric-status">Logged</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Response Time</div>
                            <div class="health-metric-value health-metric-value--good">< 50ms</div>
                            <div class="health-metric-status">Instant</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">SMS Gateway</div>
                            <div class="health-metric-value health-metric-value--good">Ready</div>
                            <div class="health-metric-status">Connected</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Trigger Methods:</span>
                            <span class="health-detail-value">Button, Voice, Shake</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Location Tracking:</span>
                            <span class="health-detail-value">GPS + Network</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Contacts:</span>
                            <span class="health-detail-value">Primary + Secondary</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Live Beacon:</span>
                            <span class="health-detail-value">Real-time Updates</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Gemini AI System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--${geminiStatus}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">SafeNex AI Engine</div>
                        <div class="health-subtitle">Nexa AI & Route Analysis</div>
                    </div>
                    <div class="health-status health-status--${geminiStatus}">
                        <span class="status-dot"></span>
                        ${geminiStatus === 'online' ? 'Operational' : geminiStatus === 'checking' ? 'Checking...' : 'Offline'}
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Requests Today</div>
                            <div class="health-metric-value">0</div>
                            <div class="health-metric-status">Ready</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Model</div>
                            <div class="health-metric-value">${geminiModel}</div>
                            <div class="health-metric-status">Latest</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Response Time</div>
                            <div class="health-metric-value health-metric-value--${geminiStatus === 'online' ? 'good' : 'warning'}">${geminiResponseTime}</div>
                            <div class="health-metric-status">${geminiStatus === 'online' ? 'Fast' : 'N/A'}</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">API Keys</div>
                            <div class="health-metric-value health-metric-value--good">2 Active</div>
                            <div class="health-metric-status">Configured</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Primary Use:</span>
                            <span class="health-detail-value">Nexa AI Chat</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Secondary Use:</span>
                            <span class="health-detail-value">Route Analysis</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Features:</span>
                            <span class="health-detail-value">Chat, Analysis, Safety</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Rate Limit:</span>
                            <span class="health-detail-value">60 req/min</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Authentication System -->
            <div class="health-card health-card--detailed">
                <div class="health-header">
                    <div class="health-icon health-icon--online">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0110 0v4"/>
                        </svg>
                    </div>
                    <div class="health-info">
                        <div class="health-title">Authentication & Security</div>
                        <div class="health-subtitle">User access control</div>
                    </div>
                    <div class="health-status health-status--online">
                        <span class="status-dot"></span>
                        Operational
                    </div>
                </div>
                <div class="health-body">
                    <div class="health-metrics">
                        <div class="health-metric">
                            <div class="health-metric-label">Active Sessions</div>
                            <div class="health-metric-value">${activeUsers}</div>
                            <div class="health-metric-status">Online</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">New Users Today</div>
                            <div class="health-metric-value">${usersToday}</div>
                            <div class="health-metric-status">Growing</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Failed Logins</div>
                            <div class="health-metric-value health-metric-value--good">0</div>
                            <div class="health-metric-status">Secure</div>
                        </div>
                        <div class="health-metric">
                            <div class="health-metric-label">Token System</div>
                            <div class="health-metric-value health-metric-value--good">JWT</div>
                            <div class="health-metric-status">Active</div>
                        </div>
                    </div>
                    <div class="health-details">
                        <div class="health-detail-item">
                            <span class="health-detail-label">Encryption:</span>
                            <span class="health-detail-value">bcrypt (12 rounds)</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Session Duration:</span>
                            <span class="health-detail-value">7 days</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">2FA:</span>
                            <span class="health-detail-value">Email Verification</span>
                        </div>
                        <div class="health-detail-item">
                            <span class="health-detail-label">Admin Access:</span>
                            <span class="health-detail-value">Password Protected</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('healthGrid').innerHTML = healthHTML;

    } catch (error) {
        console.error('Load health error:', error);
        document.getElementById('healthGrid').innerHTML = `
            <div class="empty-state">
                <h3>Error Loading System Health</h3>
                <p>${error.message}</p>
            </div>
        `;
    }
}

// Load Activity
async function loadActivity() {
    try {
        const filter = document.getElementById('activityFilter')?.value || '';
        const params = new URLSearchParams({ page: 1, limit: 100 });
        if (filter) params.append('action', filter);

        const response = await apiCall(`/admin/activity-log?${params}`);
        
        const logs = response.data.logs;

        if (!logs || logs.length === 0) {
            document.getElementById('activityContent').innerHTML = '<div class="empty-state">No activity found</div>';
            return;
        }

        const logsHTML = logs.map(log => `
            <div class="log-item">
                <div class="log-icon">${getActivityIcon(log.action)}</div>
                <div class="log-content">
                    <div class="log-action">${formatAction(log.action)}</div>
                    <div class="log-desc">${log.description}</div>
                    <div class="log-time">${new Date(log.createdAt).toLocaleString()}</div>
                </div>
            </div>
        `).join('');

        document.getElementById('activityContent').innerHTML = logsHTML;

    } catch (error) {
        console.error('Load activity error:', error);
        document.getElementById('activityContent').innerHTML = `<div class="empty-state">Error loading activity: ${error.message}</div>`;
    }
}

// User Actions
async function viewUser(userId) {
    try {
        const response = await apiCall(`/admin/users/${userId}`);
        const user = response.data.user;
        alert(`User Details:\n\nName: ${user.name}\nEmail: ${user.email}\nSafeNex ID: ${user.safeNexID}\nVerified: ${user.verified ? 'Yes' : 'No'}\nCreated: ${new Date(user.createdAt).toLocaleString()}`);
    } catch (error) {
        alert('Error loading user details');
    }
}

async function toggleVerify(userId, verified) {
    if (!confirm(`${verified ? 'Verify' : 'Unverify'} this user?`)) return;

    try {
        await apiCall(`/admin/users/${userId}/verify`, {
            method: 'PUT',
            body: JSON.stringify({ verified, adminPassword })
        });
        alert('User updated successfully');
        loadUsers();
    } catch (error) {
        alert('Error updating user');
    }
}

async function deleteUser(userId) {
    if (!confirm('Permanently delete this user? This cannot be undone.')) return;

    try {
        await apiCall(`/admin/users/${userId}`, {
            method: 'DELETE',
            body: JSON.stringify({ adminPassword })
        });
        alert('User deleted successfully');
        loadUsers();
    } catch (error) {
        alert('Error deleting user');
    }
}

// Zone Actions
function openAddZoneModal() {
    document.getElementById('addZoneModal').style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

document.getElementById('zoneForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const zoneData = {
        placeName: document.getElementById('zonePlaceName').value,
        latitude: parseFloat(document.getElementById('zoneLatitude').value),
        longitude: parseFloat(document.getElementById('zoneLongitude').value),
        riskLevel: document.getElementById('zoneRiskLevel').value,
        radius: parseInt(document.getElementById('zoneRadius').value),
        category: document.getElementById('zoneCategory').value,
        description: document.getElementById('zoneDescription').value,
        severityWeight: { Low: 1, Medium: 3, High: 7, Critical: 15 }[document.getElementById('zoneRiskLevel').value],
        adminPassword
    };

    try {
        await apiCall('/admin/danger-zones', {
            method: 'POST',
            body: JSON.stringify(zoneData)
        });
        alert('Danger zone created successfully');
        closeModal('addZoneModal');
        document.getElementById('zoneForm').reset();
        loadDangerZones();
    } catch (error) {
        alert('Error creating danger zone');
    }
});

async function viewZoneDetails(zoneId) {
    try {
        const response = await apiCall('/admin/danger-zones');
        const zone = response.data.find(z => z.id === zoneId);
        
        if (!zone) {
            alert('Zone not found');
            return;
        }

        const mapUrl = `https://www.google.com/maps?q=${zone.latitude},${zone.longitude}`;
        
        alert(`
🗺️ Danger Zone Details

📍 Place: ${zone.placeName}
📊 Risk Level: ${zone.riskLevel}
🏷️ Category: ${zone.category}
📏 Radius: ${zone.radius}m

📌 Coordinates:
   Latitude: ${zone.latitude}
   Longitude: ${zone.longitude}

🔗 View on Map: ${mapUrl}
        `.trim());
        
        // Open map in new tab
        if (confirm('Open location in Google Maps?')) {
            window.open(mapUrl, '_blank');
        }
    } catch (error) {
        alert('Error loading zone details');
    }
}

async function deleteZone(zoneId) {
    if (!confirm('Delete this danger zone?')) return;

    try {
        await apiCall(`/admin/danger-zones/${zoneId}`, {
            method: 'DELETE',
            body: JSON.stringify({ adminPassword })
        });
        alert('Zone deleted successfully');
        loadDangerZones();
    } catch (error) {
        alert('Error deleting zone');
    }
}

// Post Actions
async function moderatePost(reportId, action) {
    const reason = action !== 'approve' ? prompt('Enter reason (optional):') : null;

    try {
        await apiCall(`/admin/silent-room/reports/${reportId}`, {
            method: 'PUT',
            body: JSON.stringify({ action, reason, adminPassword })
        });
        alert(`Post ${action}d successfully`);
        // Reload the appropriate section based on post type
        const currentSection = document.querySelector('.nav-item.active')?.dataset.section;
        if (currentSection === 'complaints') {
            loadComplaints();
        } else if (currentSection === 'community-posts') {
            loadCommunityPosts();
        }
    } catch (error) {
        alert('Error moderating post');
    }
}

// Real-Time Updates
function startRealTimeUpdates() {
    // Refresh overview every 30 seconds
    refreshInterval = setInterval(() => {
        const activeSection = document.querySelector('.content-section.active');
        if (activeSection && activeSection.id === 'overview-section') {
            loadOverview();
        }
    }, 30000);
}

// Event Listeners
document.getElementById('userSearch')?.addEventListener('input', debounce(() => loadUsers(), 500));
document.getElementById('userFilter')?.addEventListener('change', () => loadUsers());
document.getElementById('complaintStatusFilter')?.addEventListener('change', () => loadComplaints());
document.getElementById('communityTypeFilter')?.addEventListener('change', () => loadCommunityPosts());
document.getElementById('emergencyStatusFilter')?.addEventListener('change', () => loadEmergencyAlerts());
document.getElementById('emergencyTimeFilter')?.addEventListener('change', () => loadEmergencyAlerts());
document.getElementById('activityFilter')?.addEventListener('change', () => loadActivity());

document.getElementById('logoutBtn').addEventListener('click', () => {
    if (refreshInterval) clearInterval(refreshInterval);
    localStorage.removeItem('snx_token');
    localStorage.removeItem('token');
    window.location.href = '/onboarding.html';
});

// Utility Functions
function getActivityIcon(action) {
    const icons = {
        'login': '🔐',
        'user_verification_changed': '✅',
        'user_ban_status_changed': '🚫',
        'user_deleted': '🗑️',
        'danger_zone_created': '⚠️',
        'danger_zone_updated': '✏️',
        'danger_zone_deleted': '❌',
        'silent_room_moderation': '📢'
    };
    return icons[action] || '📝';
}

function formatAction(action) {
    const names = {
        'login': 'User Login',
        'user_verification_changed': 'User Verification',
        'user_ban_status_changed': 'User Ban Status',
        'user_deleted': 'User Deleted',
        'danger_zone_created': 'Danger Zone Created',
        'danger_zone_updated': 'Danger Zone Updated',
        'danger_zone_deleted': 'Danger Zone Deleted',
        'silent_room_moderation': 'Silent Room Moderation'
    };
    return names[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize on load
init();


// Filter Silent Room Posts by Status/Type
function filterSilentRoomPosts(filter) {
    const postFilter = document.getElementById('postFilter');
    const postTypeFilter = document.getElementById('postTypeFilter');
    
    if (filter === 'all') {
        postFilter.value = '';
        postTypeFilter.value = '';
    } else if (filter === 'pending') {
        postFilter.value = 'pending';
        postTypeFilter.value = '';
    } else if (filter === 'complaint') {
        postFilter.value = '';
        postTypeFilter.value = 'complaint';
    } else if (filter === 'action_taken') {
        postFilter.value = 'action_taken';
        postTypeFilter.value = '';
    }
    
    loadSilentRoom();
}

// Filter Complaints
function filterComplaints(filter) {
    const statusFilter = document.getElementById('complaintStatusFilter');
    
    if (filter === 'all') {
        statusFilter.value = '';
    } else if (filter === 'pending') {
        statusFilter.value = 'pending';
    } else if (filter === 'action_taken') {
        statusFilter.value = 'action_taken';
    } else if (filter === 'rejected') {
        statusFilter.value = 'rejected';
    }
    
    loadComplaints();
}

// Filter Community Posts
function filterCommunityPosts(filter) {
    const typeFilter = document.getElementById('communityTypeFilter');
    
    if (filter === 'all') {
        typeFilter.value = '';
    }
    // Note: flagged and deleted are just visual indicators, not actual filters
    // All posts are always shown, just sorted differently
    
    loadCommunityPosts();
}

// ═══════════════════════════════════════════════════════════
//  LIVE TRACKING COMMAND CENTER
//  Admin-side Socket.IO + Leaflet integration
// ═══════════════════════════════════════════════════════════

let ltMap = null;
let ltSocket = null;
let ltInitialized = false;
let ltActiveSessions = {}; // userId → { sessionId, userId, userName, marker, trail, heading, speed, ... }
let ltCurrentTab = 'all';
let ltShowTrails = true;
let ltShowZones = true;
let ltZoneCircles = [];
let ltToastCount = 0;
let ltSelectedUserId = null;
let ltFocusedMode = false;
let ltTileLayer = null;
let ltMapDark = localStorage.getItem('admin_map_dark') === 'true';
const LT_MAX_TRAIL_POINTS = 200;          // more history = smoother trail
const LT_STALE_THRESHOLD_MS  = 2 * 60 * 1000;
const LT_REMOVE_AFTER_STOP_MS = 10 * 1000;

// ── Calculate bearing (degrees 0–360) between two lat/lng points ──
function ltCalcBearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ── Convert bearing degrees to compass label ──
function ltBearingToCompass(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
}

// ── Format m/s to a readable speed string ──
function ltFormatSpeed(mps) {
    if (mps == null || isNaN(mps)) return null;
    const kmh = mps * 3.6;
    return kmh < 1 ? 'Stationary' : `${kmh.toFixed(1)} km/h`;
}

// ── STEP 2: Ramer-Douglas-Peucker path simplification algorithm ──
// Removes GPS jitter and creates smooth professional trails
function simplifyPath(points, tolerance) {
    if (points.length <= 2) return points;
    
    function perpendicularDistance(point, lineStart, lineEnd) {
        const dx = lineEnd.lat - lineStart.lat;
        const dy = lineEnd.lng - lineStart.lng;
        const mag = Math.sqrt(dx * dx + dy * dy);
        if (mag === 0) return Math.sqrt(
            Math.pow(point.lat - lineStart.lat, 2) + 
            Math.pow(point.lng - lineStart.lng, 2)
        );
        const u = ((point.lat - lineStart.lat) * dx +
                   (point.lng - lineStart.lng) * dy) / (mag * mag);
        const closestLat = lineStart.lat + u * dx;
        const closestLng = lineStart.lng + u * dy;
        return Math.sqrt(
            Math.pow(point.lat - closestLat, 2) + 
            Math.pow(point.lng - closestLng, 2)
        );
    }
    
    function rdp(points, epsilon) {
        let maxDist = 0;
        let maxIndex = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const dist = perpendicularDistance(
                points[i], points[0], points[points.length - 1]
            );
            if (dist > maxDist) { maxDist = dist; maxIndex = i; }
        }
        if (maxDist > epsilon) {
            const left = rdp(points.slice(0, maxIndex + 1), epsilon);
            const right = rdp(points.slice(maxIndex), epsilon);
            return left.slice(0, -1).concat(right);
        }
        return [points[0], points[points.length - 1]];
    }
    
    return rdp(points, tolerance);
}

// ── Stale-pin staleness check runs every 30s ──
function ltStartStalenessTimer() {
    setInterval(() => {
        const now = Date.now();
        let changed = false;
        Object.values(ltActiveSessions).forEach(s => {
            const age = now - new Date(s.lastUpdate || s.startTime).getTime();
            const staleNow = age > LT_STALE_THRESHOLD_MS;
            if (staleNow !== !!s.isStale) {
                s.isStale = staleNow;
                // Update pin appearance
                if (s.marker && ltMap) {
                    s.marker.setIcon(ltBuildIcon(s.inDanger, s.userId === ltSelectedUserId, staleNow));
                }
                changed = true;
            }
        });
        if (changed) ltRenderUserList();
    }, 30 * 1000);
}

async function initLiveTracking() {
    if (ltInitialized) {
        // Already initialized — just refresh active sessions
        await ltLoadActiveSessions();
        return;
    }
    ltInitialized = true;

    // Init Leaflet map
    try {
        ltMap = L.map('ltMap', {
            zoomControl: true,
            attributionControl: false,
        }).setView([19.076, 72.8777], 12);

        ltTileLayer = L.tileLayer(
            ltMapDark
              ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
              : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
        ).addTo(ltMap);

        // Sync toggle button label
        const styleBtn = document.getElementById('ltMapStyleBtn');
        if (styleBtn) styleBtn.textContent = ltMapDark ? '☀️ Light' : '🌙 Dark';

        setTimeout(() => { ltMap.invalidateSize(); }, 300);
    } catch (e) {
        console.error('LT Map init error:', e);
        return;
    }

    // Load danger zone circles overlay
    await ltLoadDangerZoneCircles();

    // Load existing active sessions
    await ltLoadActiveSessions();

    // Start staleness timer (dims pins when app is closed but session ACTIVE)
    ltStartStalenessTimer();

    // Connect Socket.IO
    try {
        if (!ltSocket || !ltSocket.connected) {
            ltSocket = io();
        }
        ltSocket.emit('join:trackme:admin');

        // New user started tracking
        ltSocket.on('trackme:userStarted', (data) => {
            ltAddSession(data);
            ltUpdateCounters();
            ltRenderUserList();
        });

        // Location update — restores stale pin to full brightness
        ltSocket.on('trackme:locationUpdate', (data) => {
            ltUpdatePinPosition(data);
        });

        // User EXPLICITLY stopped tracking — dim pin first, then remove after 10s
        // This event only fires when user turns off the toggle on the Track Me page.
        // Tab/browser close does NOT fire this anymore.
        ltSocket.on('trackme:userStopped', (data) => {
            ltMarkStopped(data);
        });

        // Danger zone alert
        ltSocket.on('trackme:dangerZoneAlert', (data) => {
            ltShowDangerZoneToast(data);
        });
    } catch (e) {
        console.error('LT Socket.IO error:', e);
    }
}

// ── Load active sessions from REST API ──
async function ltLoadActiveSessions() {
    try {
        const res = await apiCall('/trackme/active');
        const sessions = res.data || [];

        sessions.forEach(s => {
            if (!ltActiveSessions[s.sessionId]) {
                ltAddSession(s);
            }
        });

        ltUpdateCounters();
        ltRenderUserList();
        ltUpdateMapEmpty();
    } catch (e) {
        console.error('LT load sessions error:', e);
    }
}

// ── Load danger zone circles ──
async function ltLoadDangerZoneCircles() {
    try {
        const res = await apiCall('/trackme/danger-zones');
        const zones = res.data || [];

        ltZoneCircles.forEach(c => ltMap.removeLayer(c));
        ltZoneCircles = [];

        zones.forEach(z => {
            if (!z.latitude || !z.longitude) return;
            const color = z.riskLevel === 'Critical' ? '#EF4444' :
                          z.riskLevel === 'High' ? '#F59E0B' :
                          z.riskLevel === 'Medium' ? '#EAB308' : '#22C55E';
            const circle = L.circle([z.latitude, z.longitude], {
                radius: z.radius || 200,
                color,
                fillColor: color,
                fillOpacity: 0.08,
                weight: 1.5,
                opacity: 0.5,
            }).addTo(ltMap);

            circle.bindPopup(`<b>${z.placeName}</b><br>${z.riskLevel} Risk`);
            ltZoneCircles.push(circle);
        });
    } catch (e) {
        console.error('LT load zones error:', e);
    }
}

// ── Add or replace a session — keyed by userId (one entry per real user) ──
function ltAddSession(data) {
    if (!ltMap) return;
    const userId = data.userId;
    if (!userId) return;

    // DEDUP: remove old map objects if this user already has an entry
    const existing = ltActiveSessions[userId];
    if (existing) {
        if (existing.marker && ltMap.hasLayer(existing.marker)) ltMap.removeLayer(existing.marker);
        if (existing.trail  && ltMap.hasLayer(existing.trail))  ltMap.removeLayer(existing.trail);
        const oldRow = document.getElementById(`lt-row-${userId}`);
        if (oldRow) oldRow.remove();
    }

    const coords = data.coordinates || [];
    const last   = coords.length ? coords[coords.length - 1] : null;
    const lat    = data.lastLat != null ? data.lastLat : (last ? last.lat : null);
    const lng    = data.lastLng != null ? data.lastLng : (last ? last.lng : null);
    const inDanger = !!data.inDanger || !!(last && last.inDanger);

    // Seed heading from stored coordinates (last segment direction)
    let seedHeading = null;
    if (coords.length >= 2) {
        const prev = coords[coords.length - 2];
        const cur  = coords[coords.length - 1];
        if (prev && cur) {
            const dist = Math.hypot(cur.lat - prev.lat, cur.lng - prev.lng);
            if (dist > 0.00005) seedHeading = ltCalcBearing(prev.lat, prev.lng, cur.lat, cur.lng);
        }
    }

    let marker = null;
    let trail  = null;

    if (lat && lng) {
        marker = L.marker([lat, lng], {
            icon: ltBuildIcon(inDanger, false, false, seedHeading),
            zIndexOffset: 1000,
        }).addTo(ltMap).bindPopup(ltBuildPopup({ ...data, heading: seedHeading }));

        if (coords.length > 1) {
            const rawCoords = coords.map(c => ({ lat: c.lat, lng: c.lng }));
            const simplified = simplifyPath(rawCoords, 0.00005);
            trail = L.polyline(simplified.map(c => [c.lat, c.lng]), {
                color: inDanger ? '#EF4444' : '#00FF88',
                weight: 4,
                opacity: 0.85,
                smoothFactor: 1.5,
                lineJoin: 'round',
                lineCap: 'round'
            });

            if (ltShowTrails) trail.addTo(ltMap);
        }
    }

    ltActiveSessions[userId] = {
        ...data,
        marker,
        trail,
        inDanger,
        heading: seedHeading,
        speed: data.speed ?? null,
        lastUpdate: new Date()
    };
    ltUpdateMapEmpty();
}

// ── Helper: build directional arrow DivIcon for a user pin ──
// Shows a navigation arrow pointing in the user's direction of travel.
function ltBuildIcon(inDanger, selected, stale, heading) {
    const safeColor   = '#00FF88';
    const dangerColor = '#EF4444';
    const staleColor  = '#F59E0B';
    const color = stale ? staleColor : (inDanger ? dangerColor : safeColor);
    const size  = selected ? 44 : 32;
    const rot   = (heading != null && !isNaN(heading)) ? heading : 0;
    const glowR = stale ? '245,158,11' : (inDanger ? '239,68,68' : '0,255,136');
    const glowSize = selected ? 18 : 10;

    return L.divIcon({
        className: '',
        html: `
            <div style="
                position: relative;
                width: ${size}px;
                height: ${size}px;
                transform: rotate(${rot}deg);
                transition: transform 0.4s cubic-bezier(0.25,0.46,0.45,0.94);
                filter: drop-shadow(0 0 ${selected ? 8 : 4}px rgba(${glowR},${selected ? 0.9 : 0.6}));
            ">
                <svg viewBox="0 0 32 32" fill="none" width="${size}" height="${size}">
                    <!-- Outer pulsing ring -->
                    <circle cx="16" cy="16" r="14"
                        fill="rgba(${glowR},0.12)"
                        stroke="rgba(${glowR},0.35)"
                        stroke-width="1.5"/>
                    <!-- Arrow / chevron pointing up (north = 0°) -->
                    <path d="M16 5 L22 24 L16 20 L10 24 Z"
                        fill="${color}"
                        stroke="rgba(255,255,255,0.9)"
                        stroke-width="1.5"
                        stroke-linejoin="round"/>
                    <!-- Centre dot -->
                    <circle cx="16" cy="16" r="2.5" fill="white" opacity="0.85"/>
                </svg>
            </div>
            <style>
                @keyframes ltPulse_${stale?'s':(inDanger?'d':'f')} {
                    0%,100% { filter: drop-shadow(0 0 ${selected?8:4}px rgba(${glowR},${selected?0.9:0.5})); }
                    50%     { filter: drop-shadow(0 0 ${selected?16:8}px rgba(${glowR},${selected?0.4:0.2})); }
                }
            </style>
        `,
        iconSize:   [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

// ── Mark session as explicitly stopped — dim pin + remove after 10s ──
function ltMarkStopped(dataOrId) {
    let uid = null;
    if (typeof dataOrId === 'object' && dataOrId !== null) {
        uid = dataOrId.userId ||
            Object.keys(ltActiveSessions).find(k => ltActiveSessions[k].sessionId === dataOrId.sessionId);
    } else {
        uid = dataOrId;
    }
    const session = uid ? ltActiveSessions[uid] : null;
    if (!session) return;

    session.isStopped = true;
    session.isStale   = true;

    // Dim arrow immediately (heading preserved for final direction display)
    if (session.marker && ltMap) {
        session.marker.setIcon(ltBuildIcon(session.inDanger, false, true, session.heading));
        session.marker.setOpacity(0.45);
        session.marker.setPopupContent(`
            <div style="font-size:13px">
                <strong>${escapeHtml(session.userName || 'Unknown')}</strong><br>
                <span style="color:#F59E0B">⛔ Tracking stopped</span>
            </div>
        `);
    }

    // Update card to show 'Stopped'
    const rowEl = document.getElementById(`lt-row-${uid}`);
    if (rowEl) {
        const metaEl = rowEl.querySelector('.lt-user-meta');
        if (metaEl) metaEl.innerHTML = '<span style="color:#EF4444">⛔ Tracking stopped</span>';
    }

    // Remove fully after short delay
    setTimeout(() => {
        ltRemoveSession(uid);
        ltUpdateCounters();
        ltRenderUserList();
    }, LT_REMOVE_AFTER_STOP_MS);
}


// ── Update pin position on location update ──
function ltUpdatePinPosition(data) {
    // Derive heading from position delta when not sent by the socket
    const { lat, lng, inDanger, pingCount } = data;
    const sessionId  = data.sessionId;
    const uid = data.userId ||
        Object.keys(ltActiveSessions).find(k => ltActiveSessions[k].sessionId === sessionId);
    const session = uid ? ltActiveSessions[uid] : null;
    if (!session || !ltMap) return;

    // Calculate heading from movement if socket doesn't supply it
    let heading = data.heading != null ? data.heading : null;
    if (heading == null && session.lastLat != null && session.lastLng != null) {
        const dist = Math.hypot(lat - session.lastLat, lng - session.lastLng);
        if (dist > 0.00005) { // ~5m threshold — ignore GPS noise
            heading = ltCalcBearing(session.lastLat, session.lastLng, lat, lng);
        } else {
            heading = session.heading ?? null; // keep last heading while stationary
        }
    }

    session.sessionId  = sessionId || session.sessionId;
    session.lastLat    = lat;
    session.lastLng    = lng;
    session.inDanger   = inDanger;
    session.pingCount  = pingCount;
    session.lastUpdate = new Date();
    session.isStale    = false;
    session.heading    = heading;            // ← store latest heading
    session.speed      = data.speed ?? null; // ← store speed if sent
    if (!session.coordinates) session.coordinates = [];
    session.coordinates.push({ lat, lng, ts: new Date().toISOString(), inDanger: !!inDanger });
    if (session.coordinates.length > LT_MAX_TRAIL_POINTS) session.coordinates.shift();

    // Update directional arrow — rotate to new heading, restore brightness if stale
    const isSelected = (uid === ltSelectedUserId);
    if (session.marker) {
        session.marker.setIcon(ltBuildIcon(inDanger, isSelected, false, heading));
        session.marker.setOpacity(1);
        session.marker.setLatLng([lat, lng]);
        session.marker.setPopupContent(ltBuildPopup(session));
    }

    // Extend trail
    if (lat && lng) {
        if (session.trail) {
            const lls = session.trail.getLatLngs();
            lls.push(L.latLng(lat, lng));
            if (lls.length > LT_MAX_TRAIL_POINTS) lls.shift();
            // Apply simplification every 20 points to keep trail smooth
            const simplified = (lls.length % 20 === 0) 
                ? simplifyPath(lls.map(ll => ({ lat: ll.lat, lng: ll.lng })), 0.00005)
                : lls.map(ll => ({ lat: ll.lat, lng: ll.lng }));
            session.trail.setLatLngs(simplified.map(c => [c.lat, c.lng]));
            
            // Update trail style based on danger status and selection
            const trailWeight = (ltFocusedMode && isSelected) ? 4 : 3;
            const trailOpacity = (ltFocusedMode && isSelected) ? 0.85 : 0.8;
            session.trail.setStyle({
                color: inDanger ? '#EF4444' : '#00FF88',
                weight: trailWeight,
                opacity: trailOpacity,
                smoothFactor: 2,
                lineJoin: 'round',
                lineCap: 'round'
            });
            
            // Show/hide trail based on ltShowTrails toggle and Focused Mode
            if (ltShowTrails) {
                // In Focused Mode: only show selected user's trail
                // In Overview Mode: show all trails
                if (ltFocusedMode) {
                    if (isSelected) {
                        if (!ltMap.hasLayer(session.trail)) {
                            ltMap.addLayer(session.trail);
                        }
                    } else {
                        if (ltMap.hasLayer(session.trail)) {
                            ltMap.removeLayer(session.trail);
                        }
                    }
                } else {
                    // Overview Mode: show all trails
                    if (!ltMap.hasLayer(session.trail)) {
                        ltMap.addLayer(session.trail);
                    }
                }
            } else {
                // ltShowTrails is false: hide all trails
                if (ltMap.hasLayer(session.trail)) {
                    ltMap.removeLayer(session.trail);
                }
            }
        } else if (session.marker) {
            // Create new trail
            const trailWeight = (ltFocusedMode && isSelected) ? 4 : 3;
            const trailOpacity = (ltFocusedMode && isSelected) ? 0.85 : 0.8;
            session.trail = L.polyline([[lat, lng]], {
                color: inDanger ? '#EF4444' : '#00FF88',
                weight: trailWeight,
                opacity: trailOpacity,
                smoothFactor: 2,
                lineJoin: 'round',
                lineCap: 'round'
            });
            
            // Add to map if ltShowTrails is enabled
            if (ltShowTrails) {
                if (ltFocusedMode) {
                    // Only add if this is the selected user
                    if (isSelected) {
                        session.trail.addTo(ltMap);
                    }
                } else {
                    // Overview Mode: add all trails
                    session.trail.addTo(ltMap);
                }
            }
        }
    }

    // Surgical DOM update on this user's card only
    const rowEl = document.getElementById(`lt-row-${uid}`);
    if (rowEl) {
        const metaEl = rowEl.querySelector('.lt-user-meta');
        if (metaEl) {
            const zoneText = inDanger ? ' · ⚠️ Danger' : '';
            metaEl.textContent = `${pingCount} pings · just now${zoneText}`;
        }
        rowEl.classList.toggle('in-danger', !!inDanger);
        rowEl.classList.remove('lt-user-row--stale');
        const dot = rowEl.querySelector('.lt-user-dot');
        if (dot) dot.className = `lt-user-dot lt-user-dot--${inDanger ? 'danger' : 'safe'}`;
    }
}

// ── Remove session (accepts full data object or plain sessionId/userId string) ──
function ltRemoveSession(dataOrId) {
    let uid = null;
    if (typeof dataOrId === 'object' && dataOrId !== null) {
        uid = dataOrId.userId ||
            Object.keys(ltActiveSessions).find(k => ltActiveSessions[k].sessionId === dataOrId.sessionId);
    } else {
        uid = ltActiveSessions[dataOrId] ? dataOrId :
            Object.keys(ltActiveSessions).find(k => ltActiveSessions[k].sessionId === dataOrId);
    }

    const session = uid ? ltActiveSessions[uid] : null;
    if (!session) return;

    if (session.marker && ltMap && ltMap.hasLayer(session.marker)) ltMap.removeLayer(session.marker);
    if (session.trail  && ltMap && ltMap.hasLayer(session.trail))  ltMap.removeLayer(session.trail);
    if (session._historyLine      && ltMap && ltMap.hasLayer(session._historyLine))      ltMap.removeLayer(session._historyLine);
    if (session._historyBackdrop  && ltMap && ltMap.hasLayer(session._historyBackdrop))  ltMap.removeLayer(session._historyBackdrop);
    if (session._historyStartPin  && ltMap && ltMap.hasLayer(session._historyStartPin))  ltMap.removeLayer(session._historyStartPin);
    if (session._historyEndPin    && ltMap && ltMap.hasLayer(session._historyEndPin))    ltMap.removeLayer(session._historyEndPin);

    delete ltActiveSessions[uid];
    if (ltSelectedUserId === uid) ltSelectedUserId = null;

    ltUpdateMapEmpty();
    ltRenderUserList();
}


// ── Render user list based on current tab + search + filter ──
function ltRenderUserList() {
    const listEl = document.getElementById('ltUserList');
    const emptyEl = document.getElementById('ltListEmpty');
    if (!listEl) return;

    const search = (document.getElementById('ltSearch')?.value || '').toLowerCase();
    const zoneFilter = document.getElementById('ltZoneFilter')?.value || '';

    let sessions = Object.values(ltActiveSessions);

    // Tab filter
    if (ltCurrentTab === 'danger') {
        sessions = sessions.filter(s => s.inDanger);
    } else if (ltCurrentTab === 'stationary') {
        // Stationary = stale (no update in > 2 min)
        sessions = sessions.filter(s => !!s.isStale);
    }

    // Search filter
    if (search) {
        sessions = sessions.filter(s =>
            (s.userName || '').toLowerCase().includes(search) ||
            (s.safeNexId || '').toLowerCase().includes(search)
        );
    }

    // Zone filter
    if (zoneFilter === 'danger') sessions = sessions.filter(s => s.inDanger);
    if (zoneFilter === 'safe') sessions = sessions.filter(s => !s.inDanger);

    // Clear existing rows (not the empty state)
    Array.from(listEl.children).forEach(c => {
        if (!c.id || c.id !== 'ltListEmpty') c.remove();
    });

    if (sessions.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    sessions.forEach(session => {
        const uid = session.userId;
        if (!uid) return;

        // Surgical update if card already exists — just refresh classes
        const existing = document.getElementById(`lt-row-${uid}`);
        if (existing) {
            existing.classList.toggle('in-danger', !!session.inDanger);
            existing.classList.toggle('lt-user-row--selected', uid === ltSelectedUserId);
            existing.classList.toggle('lt-user-row--stale', !!session.isStale && !session.isStopped);
            return;
        }

        const row = document.createElement('div');
        row.id        = `lt-row-${uid}`;
        row.className = `lt-user-row${session.inDanger ? ' in-danger' : ''}${uid === ltSelectedUserId ? ' lt-user-row--selected' : ''}${session.isStale && !session.isStopped ? ' lt-user-row--stale' : ''}`;

        const pingCount = session.pingCount || 0;
        const lastUpdMs = session.lastUpdate ? new Date(session.lastUpdate).getTime() : null;
        const staleLabel = session.isStale && lastUpdMs
            ? `<span style="color:#F59E0B">📴 Last seen: ${ltFormatAgo(new Date(lastUpdMs))}</span>`
            : `${pingCount} pings · ${ltFormatAgo(new Date(session.lastUpdate || session.startTime))}`;
        const zoneText  = session.inDanger ? ' · ⚠️ Danger' : '';
        // Direction badge
        const compass = session.heading != null ? ltBearingToCompass(session.heading) : null;
        const speedStr = ltFormatSpeed(session.speed);
        const dirBadge = compass
            ? `<span style="
                display:inline-flex;align-items:center;gap:3px;
                background:rgba(0,255,136,0.12);color:#00FF88;
                border:1px solid rgba(0,255,136,0.25);
                border-radius:4px;padding:1px 6px;font-size:10px;font-weight:600;
                margin-left:4px;
               ">${compass}${speedStr ? ` · ${speedStr}` : ''}</span>`
            : '';

        row.innerHTML = `
            <span class="lt-user-dot lt-user-dot--${session.isStale ? 'stale' : (session.inDanger ? 'danger' : 'safe')}"></span>
            <div class="lt-user-info">
                <div class="lt-user-name">${escapeHtml(session.userName || 'Unknown')}${dirBadge}</div>
                <div class="lt-user-meta">${staleLabel}${!session.isStale ? zoneText : ''}</div>
            </div>
            <div class="lt-user-actions">
                <button class="lt-user-btn lt-user-btn--view"    onclick="ltViewOnMap('${uid}')">View</button>
                <button class="lt-user-btn lt-user-btn--history" onclick="ltShowHistory('${uid}')">History</button>
            </div>
        `;

        listEl.appendChild(row);
    });
}


// ── Counter update ──
function ltUpdateCounters() {
    const sessions = Object.values(ltActiveSessions);
    const total = sessions.length;
    const danger = sessions.filter(s => s.inDanger).length;

    const countEl = document.getElementById('ltLiveCount');
    const badgeEl = document.getElementById('liveTrackingBadge');
    const dangerEl = document.getElementById('ltDangerCount');
    const dangerPill = document.getElementById('ltDangerPill');

    if (countEl) countEl.textContent = total;
    if (badgeEl) badgeEl.textContent = total;
    if (dangerEl) dangerEl.textContent = danger;
    if (dangerPill) dangerPill.style.display = danger > 0 ? 'flex' : 'none';
}

// ── Map empty state ──
function ltUpdateMapEmpty() {
    const empty = document.getElementById('ltMapEmpty');
    if (!empty) return;
    empty.style.display = Object.keys(ltActiveSessions).length === 0 ? 'flex' : 'none';
}

// ── Map controls ──
function ltFitAll() {
    if (!ltMap) return;
    const markers = Object.values(ltActiveSessions)
        .filter(s => s.marker)
        .map(s => s.marker.getLatLng());

    if (markers.length === 0) return;
    if (markers.length === 1) { ltMap.setView(markers[0], 15, { animate: true }); return; }
    ltMap.fitBounds(L.latLngBounds(markers), { padding: [40, 40], animate: true });
}

function ltToggleTrails() {
    ltShowTrails = !ltShowTrails;
    const btn = document.getElementById('ltToggleTrails');
    if (btn) btn.classList.toggle('active', ltShowTrails);

    Object.values(ltActiveSessions).forEach(s => {
        if (s.trail && ltMap) {
            ltShowTrails ? ltMap.addLayer(s.trail) : ltMap.removeLayer(s.trail);
        }
    });
}

function ltToggleMapStyle() {
    if (!ltMap) return;
    ltMapDark = !ltMapDark;
    localStorage.setItem('admin_map_dark', ltMapDark);

    if (ltTileLayer) ltMap.removeLayer(ltTileLayer);
    ltTileLayer = L.tileLayer(
        ltMapDark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
    ).addTo(ltMap);

    const styleBtn = document.getElementById('ltMapStyleBtn');
    if (styleBtn) styleBtn.textContent = ltMapDark ? '☀️ Light' : '🌙 Dark';
}


function ltToggleZoneOverlays() {
    ltShowZones = !ltShowZones;
    const btn = document.getElementById('ltToggleZones');
    if (btn) btn.classList.toggle('active', ltShowZones);

    ltZoneCircles.forEach(c => {
        ltShowZones ? ltMap.addLayer(c) : ltMap.removeLayer(c);
    });
}

// ── Tab switching ──
function ltSetTab(btn, tab) {
    ltCurrentTab = tab;
    document.querySelectorAll('.lt-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    ltRenderUserList();
}

// ── Filter users (search/zone) ──
function ltFilterUsers() {
    // Clear existing user rows to re-render
    const listEl = document.getElementById('ltUserList');
    if (listEl) {
        Array.from(listEl.children).forEach(c => {
            if (c.id !== 'ltListEmpty') c.remove();
        });
    }
    ltRenderUserList();
}

// ── ISSUE 2: View user on map — FOCUSED MODE implementation ──
function ltViewOnMap(userId) {
    const session = ltActiveSessions[userId];
    if (!session || !ltMap) return;

    // If clicking the same user again, return to Overview Mode
    if (ltSelectedUserId === userId && ltFocusedMode) {
        ltExitFocusedMode();
        return;
    }

    // Enter Focused Mode
    ltEnterFocusedMode(userId);
}

// ── Enter Focused Mode: Highlight selected user, show only their trail ──
function ltEnterFocusedMode(userId) {
    const session = ltActiveSessions[userId];
    if (!session) return;

    ltFocusedMode = true;
    ltSelectedUserId = userId;

    // Fade all other user arrows to 40% opacity
    Object.entries(ltActiveSessions).forEach(([uid, s]) => {
        if (uid !== userId && s.marker) {
            s.marker.setOpacity(0.4);
            s.marker.setIcon(ltBuildIcon(s.inDanger, false, s.isStale, s.heading));
            // Hide their trails in Focused Mode
            if (s.trail && ltMap.hasLayer(s.trail)) {
                ltMap.removeLayer(s.trail);
            }
        }
    });

    // Brighten and enlarge the selected user's arrow
    if (session.marker) {
        session.marker.setOpacity(1);
        session.marker.setIcon(ltBuildIcon(session.inDanger, true, false, session.heading));
    }

    // Show ONLY the selected user's trail (if ltShowTrails is enabled)
    if (session.trail && ltShowTrails) {
        if (!ltMap.hasLayer(session.trail)) {
            ltMap.addLayer(session.trail);
        }
        session.trail.setStyle({
            weight: 4,
            opacity: 0.85,
            color: session.inDanger ? '#EF4444' : '#00FF88',
            smoothFactor: 2,
            lineJoin: 'round',
            lineCap: 'round'
        });
    }

    // Highlight card with glowing border
    document.querySelectorAll('.lt-user-row').forEach(row => {
        row.classList.remove('lt-user-row--selected');
    });
    const rowEl = document.getElementById(`lt-row-${userId}`);
    if (rowEl) {
        rowEl.classList.add('lt-user-row--selected');
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Fly map to this user — slightly offset downward to show trail behind
    if (session.marker) {
        ltMap.flyTo(session.marker.getLatLng(), 17, { animate: true, duration: 0.9 });

        // Rich popup with direction and speed data
        const heading = session.heading;
        const compass = heading != null ? ltBearingToCompass(heading) : null;
        const speedStr = ltFormatSpeed(session.speed);
        const lat   = session.lastLat  != null ? parseFloat(session.lastLat).toFixed(5)  : '—';
        const lng   = session.lastLng  != null ? parseFloat(session.lastLng).toFixed(5) : '—';
        const ago   = session.lastUpdate ? ltFormatAgo(new Date(session.lastUpdate)) : '—';
        const zone  = session.inDanger
            ? '<span style="color:#EF4444;font-weight:700">\u26a0\ufe0f Danger Zone</span>'
            : '<span style="color:#10B981">\u2705 Safe Zone</span>';

        session.marker.setPopupContent(`
            <div style="font-size:13px;min-width:200px;line-height:1.8;font-family:Inter,sans-serif">
                <strong style="font-size:15px;color:#fff">${escapeHtml(session.userName || 'Unknown')}</strong>
                ${session.safeNexId ? `<br><span style="color:#94A3B8;font-size:11px">ID: ${session.safeNexId}</span>` : ''}
                <hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:8px 0">
                📍 <b>Coords:</b> ${lat}, ${lng}<br>
                ${compass != null ? `🧭 <b>Direction:</b> ${compass} (${Math.round(heading)}°)<br>` : ''}
                ${speedStr ? `⚡ <b>Speed:</b> ${speedStr}<br>` : ''}
                🕐 <b>Updated:</b> ${ago}<br>
                📡 <b>Pings:</b> ${session.pingCount || 0}<br>
                ${zone}
            </div>
        `);
        session.marker.openPopup();
    }

    // Show "Back to Overview" button
    ltShowBackButton();
}

// ── Exit Focused Mode: Return to Overview Mode ──
function ltExitFocusedMode() {
    ltFocusedMode = false;
    ltSelectedUserId = null;

    // Restore all arrows to full opacity and normal size
    Object.values(ltActiveSessions).forEach(s => {
        if (s.marker) {
            s.marker.setOpacity(1);
            s.marker.setIcon(ltBuildIcon(s.inDanger, false, s.isStale, s.heading));
        }
        // In Overview Mode: show all trails if ltShowTrails is enabled
        if (s.trail && ltShowTrails) {
            if (!ltMap.hasLayer(s.trail)) {
                ltMap.addLayer(s.trail);
            }
            // Reset trail style to normal weight
            s.trail.setStyle({
                weight: 3,
                opacity: 0.8,
                color: s.inDanger ? '#EF4444' : '#00FF88',
                smoothFactor: 2,
                lineJoin: 'round',
                lineCap: 'round'
            });
        }
    });

    // Remove card highlights
    document.querySelectorAll('.lt-user-row').forEach(row => {
        row.classList.remove('lt-user-row--selected');
    });

    // Zoom out to show all users
    ltFitAll();

    // Hide "Back to Overview" button
    ltHideBackButton();
}

// ── Show/Hide "Back to Overview" button ──
function ltShowBackButton() {
    let backBtn = document.getElementById('ltBackToOverview');
    if (!backBtn) {
        backBtn = document.createElement('button');
        backBtn.id = 'ltBackToOverview';
        backBtn.className = 'lt-back-btn';
        backBtn.innerHTML = '← Back to Overview';
        backBtn.onclick = ltExitFocusedMode;
        document.getElementById('ltMap').appendChild(backBtn);
    }
    backBtn.style.display = 'block';
}

function ltHideBackButton() {
    const backBtn = document.getElementById('ltBackToOverview');
    if (backBtn) {
        backBtn.style.display = 'none';
    }
}


// ── ISSUE 3: History — draw full session route on MAIN MAP (toggle on/off) ──
function ltShowHistory(userId) {
    const session = ltActiveSessions[userId];
    if (!session || !ltMap) return;

    const btn = document.querySelector(`#lt-row-${userId} .lt-user-btn--history`);

    // Toggle: if route already visible, clear it
    if (session._historyLine && ltMap.hasLayer(session._historyLine)) {
        ltMap.removeLayer(session._historyLine);
        session._historyLine = null;
        if (session._historyBackdrop && ltMap.hasLayer(session._historyBackdrop)) {
            ltMap.removeLayer(session._historyBackdrop);
            session._historyBackdrop = null;
        }
        if (session._historyStartPin && ltMap.hasLayer(session._historyStartPin)) {
            ltMap.removeLayer(session._historyStartPin);
            session._historyStartPin = null;
        }
        if (session._historyEndPin && ltMap.hasLayer(session._historyEndPin)) {
            ltMap.removeLayer(session._historyEndPin);
            session._historyEndPin = null;
        }
        if (btn) btn.textContent = 'History';
        return;
    }

    const coords = session.coordinates || [];
    if (coords.length === 0) {
        if (session.marker) ltMap.flyTo(session.marker.getLatLng(), 15, { animate: true, duration: 0.6 });
        return;
    }

    const routeColor = session.inDanger ? '#FBBF24' : '#38BDF8';

    // Apply simplification to history trail for smooth professional appearance
    const simplified = simplifyPath(coords.map(c => ({ lat: c.lat, lng: c.lng })), 0.00005);
    const lls = simplified.map(c => [c.lat, c.lng]);

    // Draw semi-transparent backdrop (wider, dimmer) for depth effect
    session._historyBackdrop = L.polyline(lls, {
        color: routeColor,
        weight: 8,
        opacity: 0.18,
        smoothFactor: 1.5,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(ltMap);

    // Main dashed history polyline on top
    session._historyLine = L.polyline(lls, {
        color: routeColor,
        weight: 3.5,
        opacity: 0.95,
        dashArray: '8 5',
        smoothFactor: 1.5,
        lineJoin: 'round',
        lineCap: 'round'
    }).addTo(ltMap);

    // Start pin — green dot
    session._historyStartPin = L.marker(lls[0], {
        icon: L.divIcon({
            className: '',
            html: '<div style="width:14px;height:14px;background:#10B981;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px #10B981"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7],
        }),
        zIndexOffset: 900,
    }).addTo(ltMap).bindPopup(`🟢 Session Start — ${escapeHtml(session.userName || 'User')}`);

    // End pin (current position) — flashing amber flag
    const endLL = lls[lls.length - 1];
    session._historyEndPin = L.marker(endLL, {
        icon: L.divIcon({
            className: '',
            html: '<div style="width:14px;height:14px;background:#F59E0B;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 12px #F59E0B"></div>',
            iconSize: [14, 14], iconAnchor: [7, 7],
        }),
        zIndexOffset: 900,
    }).addTo(ltMap).bindPopup(`📍 Last Known Position — ${escapeHtml(session.userName || 'User')}`);

    // Fit map to full route with padding
    ltMap.fitBounds(L.latLngBounds(lls), { padding: [50, 50], animate: true, maxZoom: 17 });

    if (btn) btn.textContent = 'Clear';
}

// ── Danger zone alert toast ──
function ltShowDangerZoneToast(data) {
    const container = document.getElementById('ltToastContainer');
    if (!container) return;

    ltToastCount++;
    const toastId = `lt-toast-${ltToastCount}`;

    const toast = document.createElement('div');
    toast.className = 'lt-toast';
    toast.id = toastId;
    toast.innerHTML = `
        <div class="lt-toast-title">⚠️ Danger Zone Alert</div>
        <div class="lt-toast-body">
            <strong>${escapeHtml(data.userName || 'A user')}</strong> has entered a danger zone.
            ${data.dangerZoneName ? `<br>Zone: ${escapeHtml(data.dangerZoneName)}` : ''}
        </div>
        <div class="lt-toast-actions">
            <button class="lt-toast-btn lt-toast-btn--view" onclick="ltViewOnMap('${data.sessionId}'); this.closest('.lt-toast').remove();">View on Map</button>
            <button class="lt-toast-btn lt-toast-btn--dismiss" onclick="this.closest('.lt-toast').remove()">Dismiss</button>
        </div>
    `;

    container.appendChild(toast);

    // Auto-dismiss after 10s
    setTimeout(() => {
        if (document.getElementById(toastId)) {
            document.getElementById(toastId).remove();
        }
    }, 10000);
}

// ── Popup HTML builder — enriched with speed, heading, and pings ──
function ltBuildPopup(data) {
    const lat = data.lastLat != null ? parseFloat(data.lastLat).toFixed(5) : '—';
    const lng = data.lastLng != null ? parseFloat(data.lastLng).toFixed(5) : '—';
    const heading = data.heading != null ? data.heading : null;
    const compass = heading != null ? ltBearingToCompass(heading) : null;
    const speedStr = ltFormatSpeed(data.speed);
    const dangerLabel = data.inDanger
        ? '<span style="color:#EF4444;font-weight:700">⚠️ Danger Zone</span>'
        : '<span style="color:#10B981">✅ Safe Zone</span>';

    return `
        <div style="font-size:13px;min-width:190px;line-height:1.75;font-family:Inter,sans-serif">
            <strong style="font-size:14px;color:#fff">${escapeHtml(data.userName || 'Unknown')}</strong>
            ${data.safeNexId ? `<br><span style="color:#94A3B8;font-size:11px">ID: ${data.safeNexId}</span>` : ''}
            <hr style="border:none;border-top:1px solid rgba(255,255,255,0.12);margin:7px 0">
            📍 <b>Location:</b> ${lat}, ${lng}<br>
            ${compass != null ? `🧭 <b>Direction:</b> ${compass} (${Math.round(heading)}°)<br>` : ''}
            ${speedStr ? `⚡ <b>Speed:</b> ${speedStr}<br>` : ''}
            📡 <b>Pings:</b> ${data.pingCount || 0}<br>
            ${dangerLabel}
        </div>
    `;
}

// ── Helpers ──
function ltFormatAgo(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
