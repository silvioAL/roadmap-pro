import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const resolver = new Resolver();

// ============================================================================
// HELPER: Função reutilizável para busca JQL
// ============================================================================

async function searchJql(jql, options = {}) {
    const {
        maxResults = 100,
        startAt = 0,
        fields = ['summary', 'status'],
        expand = []
    } = options;

    const fieldsParam = Array.isArray(fields) ? fields.join(',') : fields;
    const expandParam = expand.length > 0 ? expand.join(',') : '';

    let response;

    if (expandParam) {
        response = await api.asApp().requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fieldsParam}&expand=${expandParam}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            }
        );
    } else {
        response = await api.asApp().requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&startAt=${startAt}&maxResults=${maxResults}&fields=${fieldsParam}`,
            {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            }
        );
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Jira API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.issues) {
        data.issues = [];
    }

    return data;
}

// ============================================================================
// CONFIGURAÇÃO E TIPOS DE ISSUE
// ============================================================================

resolver.define('getIssueTypes', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;

        const response = await api.asApp().requestJira(
            route`/rest/api/3/project/${projectKey}`,
            { headers: { 'Accept': 'application/json' } }
        );

        const project = await response.json();

        const hierarchyResponse = await api.asApp().requestJira(
            route`/rest/api/3/issuetype/project?projectId=${project.id}`,
            { headers: { 'Accept': 'application/json' } }
        );

        const issueTypes = await hierarchyResponse.json();

        return {
            success: true,
            projectKey,
            projectId: project.id,
            projectName: project.name,
            issueTypes: issueTypes.map(it => ({
                id: it.id,
                name: it.name,
                description: it.description,
                iconUrl: it.iconUrl,
                subtask: it.subtask,
                hierarchyLevel: it.hierarchyLevel || 0
            }))
        };
    } catch (error) {
        console.error('Error fetching issue types:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getLinkTypes', async () => {
    try {
        const response = await api.asApp().requestJira(
            route`/rest/api/3/issueLinkType`,
            { headers: { 'Accept': 'application/json' } }
        );

        const data = await response.json();

        return {
            success: true,
            linkTypes: data.issueLinkTypes.map(lt => ({
                id: lt.id,
                name: lt.name,
                inward: lt.inward,
                outward: lt.outward
            }))
        };
    } catch (error) {
        console.error('Error fetching link types:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getCustomFields', async () => {
    try {
        const response = await api.asApp().requestJira(
            route`/rest/api/3/field`,
            { headers: { 'Accept': 'application/json' } }
        );

        const fields = await response.json();

        const customFields = fields
            .filter(f => f.custom)
            .map(f => ({
                id: f.id,
                name: f.name,
                type: f.schema?.type || 'unknown',
                custom: true
            }));

        return { success: true, fields: customFields };
    } catch (error) {
        console.error('Error fetching custom fields:', error);
        return { success: false, error: error.message };
    }
});

// ============================================================================
// BUSCA DE ISSUES
// ============================================================================

resolver.define('searchIssues', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { issueTypes, maxResults = 100, startAt = 0, jql: customJql } = payload || {};

        let jql = customJql || `project = "${projectKey}"`;
        if (!customJql && issueTypes && issueTypes.length > 0) {
            jql += ` AND issuetype IN (${issueTypes.map(t => `"${t}"`).join(',')})`;
        }
        if (!customJql) {
            jql += ' ORDER BY rank ASC, created DESC';
        }

        console.log('Executing JQL:', jql);

        const data = await searchJql(jql, {
            maxResults,
            startAt,
            fields: ['summary', 'issuetype', 'status', 'priority', 'parent', 'issuelinks', 'subtasks', 'created', 'updated', 'resolutiondate', 'assignee', 'labels']
        });

        const issues = data.issues.map(issue => ({
            id: issue.id,
            key: issue.key,
            summary: issue.fields.summary,
            type: {
                id: issue.fields.issuetype?.id,
                name: issue.fields.issuetype?.name,
                iconUrl: issue.fields.issuetype?.iconUrl,
                hierarchyLevel: issue.fields.issuetype?.hierarchyLevel
            },
            status: {
                id: issue.fields.status?.id,
                name: issue.fields.status?.name,
                category: issue.fields.status?.statusCategory?.key
            },
            priority: issue.fields.priority ? {
                id: issue.fields.priority.id,
                name: issue.fields.priority.name,
                iconUrl: issue.fields.priority.iconUrl
            } : null,
            parent: issue.fields.parent ? {
                id: issue.fields.parent.id,
                key: issue.fields.parent.key,
                summary: issue.fields.parent.fields?.summary
            } : null,
            links: (issue.fields.issuelinks || []).map(link => ({
                id: link.id,
                type: {
                    name: link.type.name,
                    inward: link.type.inward,
                    outward: link.type.outward
                },
                inwardIssue: link.inwardIssue ? {
                    id: link.inwardIssue.id,
                    key: link.inwardIssue.key,
                    summary: link.inwardIssue.fields?.summary,
                    status: link.inwardIssue.fields?.status?.name
                } : null,
                outwardIssue: link.outwardIssue ? {
                    id: link.outwardIssue.id,
                    key: link.outwardIssue.key,
                    summary: link.outwardIssue.fields?.summary,
                    status: link.outwardIssue.fields?.status?.name
                } : null
            })),
            subtasksCount: issue.fields.subtasks?.length || 0,
            labels: issue.fields.labels || [],
            created: issue.fields.created,
            updated: issue.fields.updated,
            resolutiondate: issue.fields.resolutiondate
        }));

        return {
            success: true,
            issues,
            total: data.total,
            startAt: data.startAt,
            maxResults: data.maxResults
        };
    } catch (error) {
        console.error('Error searching issues:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('countChildIssues', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { parentKey } = payload;

        const jql = `project = "${projectKey}" AND parent = "${parentKey}"`;

        const data = await searchJql(jql, {
            maxResults: 1000,
            fields: ['status']
        });

        const statusCounts = { todo: 0, inProgress: 0, done: 0 };

        data.issues.forEach(issue => {
            const category = issue.fields.status?.statusCategory?.key;
            if (category === 'done') statusCounts.done++;
            else if (category === 'indeterminate') statusCounts.inProgress++;
            else statusCounts.todo++;
        });

        return {
            success: true,
            parentKey,
            total: data.total,
            ...statusCounts
        };
    } catch (error) {
        console.error('Error counting child issues:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getIssueDetails', async ({ payload }) => {
    try {
        const { issueKey } = payload;

        const response = await api.asApp().requestJira(
            route`/rest/api/3/issue/${issueKey}?expand=changelog`,
            { headers: { 'Accept': 'application/json' } }
        );

        const issue = await response.json();

        return {
            success: true,
            issue: {
                id: issue.id,
                key: issue.key,
                summary: issue.fields.summary,
                description: issue.fields.description,
                type: issue.fields.issuetype,
                status: issue.fields.status,
                priority: issue.fields.priority,
                parent: issue.fields.parent,
                links: issue.fields.issuelinks,
                subtasks: issue.fields.subtasks,
                created: issue.fields.created,
                updated: issue.fields.updated,
                resolutiondate: issue.fields.resolutiondate,
                labels: issue.fields.labels,
                changelog: issue.changelog
            }
        };
    } catch (error) {
        console.error('Error fetching issue details:', error);
        return { success: false, error: error.message };
    }
});

// ============================================================================
// MÉTRICAS E ESTATÍSTICAS
// ============================================================================

// Helper para calcular estatísticas
function calcStats(arr) {
    if (!arr || arr.length === 0) return { avg: 0, median: 0, p85: 0, p95: 0, stdDev: 0, cov: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / arr.length;
    const stdDev = Math.sqrt(variance);
    return {
        avg: Math.round(avg * 100) / 100,
        median: Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100,
        p85: Math.round(sorted[Math.floor(sorted.length * 0.85)] * 100) / 100,
        p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
        stdDev: Math.round(stdDev * 100) / 100,
        cov: avg > 0 ? Math.round((stdDev / avg) * 100) / 100 : 0
    };
}

// Helper para construir JQL de métricas
function buildMetricsJql(projectKey, issueTypes, weeks, statusCategory = null) {
    const weeksAgo = new Date();
    weeksAgo.setDate(weeksAgo.getDate() - (weeks * 7));
    const dateStr = weeksAgo.toISOString().split('T')[0];

    let jql = `project = "${projectKey}"`;

    if (statusCategory === 'Done') {
        jql += ` AND statusCategory = Done AND resolved >= "${dateStr}"`;
    } else if (statusCategory === 'InProgress') {
        jql += ` AND statusCategory = "In Progress"`;
    }

    if (issueTypes && issueTypes.length > 0) {
        jql += ` AND issuetype IN (${issueTypes.map(t => `"${t}"`).join(',')})`;
    }

    return jql;
}

resolver.define('getThroughputHistory', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { weeks = 12, issueTypes, serviceClassField } = payload || {};

        const jql = buildMetricsJql(projectKey, issueTypes, weeks, 'Done');

        const fields = ['resolutiondate', 'issuetype', 'labels'];
        if (serviceClassField) fields.push(serviceClassField);

        const data = await searchJql(jql, { maxResults: 1000, fields });

        // Agrupar por semana
        const weeklyData = {};
        const weeklyByClass = {};

        data.issues.forEach(issue => {
            const resolved = new Date(issue.fields.resolutiondate);
            const weekStart = new Date(resolved);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekKey = weekStart.toISOString().split('T')[0];

            weeklyData[weekKey] = (weeklyData[weekKey] || 0) + 1;

            if (serviceClassField) {
                const classValue = issue.fields[serviceClassField] || 'standard';
                if (!weeklyByClass[classValue]) weeklyByClass[classValue] = {};
                weeklyByClass[classValue][weekKey] = (weeklyByClass[classValue][weekKey] || 0) + 1;
            }
        });

        const stats = calcStats(Object.values(weeklyData));

        // Estatísticas por classe
        const classStatistics = {};
        Object.keys(weeklyByClass).forEach(classKey => {
            classStatistics[classKey] = calcStats(Object.values(weeklyByClass[classKey]));
        });

        return {
            success: true,
            weeklyData,
            weeklyByClass,
            statistics: {
                totalIssues: data.total,
                weeksAnalyzed: weeks,
                average: stats.avg,
                stdDev: stats.stdDev,
                cov: stats.cov
            },
            classStatistics
        };
    } catch (error) {
        console.error('Error fetching throughput history:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getLeadTimeHistory', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { weeks = 12, issueTypes, inProgressStatuses = ['In Progress', 'Em Andamento'], doneStatuses = ['Done', 'Concluído'] } = payload || {};

        const jql = buildMetricsJql(projectKey, issueTypes, weeks, 'Done');

        const data = await searchJql(jql, {
            maxResults: 200,
            fields: ['created', 'resolutiondate', 'issuetype'],
            expand: ['changelog']
        });

        const leadTimes = [];
        const cycleTimes = [];

        data.issues.forEach(issue => {
            const created = new Date(issue.fields.created);
            const resolved = new Date(issue.fields.resolutiondate);
            const leadTimeDays = (resolved - created) / (1000 * 60 * 60 * 24);
            leadTimes.push(leadTimeDays);

            if (issue.changelog?.histories) {
                let inProgressDate = null;
                let doneDate = null;

                issue.changelog.histories.forEach(history => {
                    history.items.forEach(item => {
                        if (item.field === 'status') {
                            if (!inProgressDate && inProgressStatuses.includes(item.toString)) {
                                inProgressDate = new Date(history.created);
                            }
                            if (doneStatuses.includes(item.toString)) {
                                doneDate = new Date(history.created);
                            }
                        }
                    });
                });

                if (inProgressDate && doneDate) {
                    cycleTimes.push((doneDate - inProgressDate) / (1000 * 60 * 60 * 24));
                }
            }
        });

        return {
            success: true,
            leadTime: calcStats(leadTimes),
            cycleTime: calcStats(cycleTimes),
            sampleSize: data.total
        };
    } catch (error) {
        console.error('Error calculating lead time:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getCurrentWip', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { issueTypes } = payload || {};

        const jql = buildMetricsJql(projectKey, issueTypes, 0, 'InProgress');

        const data = await searchJql(jql, { maxResults: 0, fields: ['status'] });

        return { success: true, wip: data.total };
    } catch (error) {
        console.error('Error fetching WIP:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getWipIdeal', async ({ payload, context }) => {
    try {
        const { issueTypes, weeks = 12 } = payload || {};

        const [throughputResult, leadTimeResult] = await Promise.all([
            resolver.getDefinitions().getThroughputHistory({ payload: { weeks, issueTypes }, context }),
            resolver.getDefinitions().getLeadTimeHistory({ payload: { weeks, issueTypes }, context })
        ]);

        if (!throughputResult.success || !leadTimeResult.success) {
            throw new Error('Falha ao buscar métricas');
        }

        const throughputPerWeek = throughputResult.statistics.average;
        const leadTimeWeeks = leadTimeResult.leadTime.avg / 7;
        const wipIdeal = Math.round(throughputPerWeek * leadTimeWeeks);

        return {
            success: true,
            wipIdeal: Math.max(1, wipIdeal),
            throughputPerWeek,
            leadTimeDays: leadTimeResult.leadTime.avg,
            leadTimeWeeks: Math.round(leadTimeWeeks * 10) / 10
        };
    } catch (error) {
        console.error('Error calculating WIP ideal:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('getAllMetrics', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const { issueTypes, weeks = 12 } = payload || {};

        const doneJql = buildMetricsJql(projectKey, issueTypes, weeks, 'Done');
        const wipJql = buildMetricsJql(projectKey, issueTypes, 0, 'InProgress');

        const [throughputData, leadTimeData, wipData] = await Promise.all([
            searchJql(doneJql, { maxResults: 1000, fields: ['resolutiondate', 'labels'] }),
            searchJql(doneJql, { maxResults: 200, fields: ['created', 'resolutiondate'], expand: ['changelog'] }),
            searchJql(wipJql, { maxResults: 0, fields: ['status'] })
        ]);

        // Processar Throughput
        const weeklyData = {};
        throughputData.issues.forEach(issue => {
            const resolved = new Date(issue.fields.resolutiondate);
            const weekStart = new Date(resolved);
            weekStart.setDate(weekStart.getDate() - weekStart.getDay());
            const weekKey = weekStart.toISOString().split('T')[0];
            weeklyData[weekKey] = (weeklyData[weekKey] || 0) + 1;
        });

        const tpStats = calcStats(Object.values(weeklyData));

        // Processar Lead Time
        const leadTimes = leadTimeData.issues.map(issue => {
            const created = new Date(issue.fields.created);
            const resolved = new Date(issue.fields.resolutiondate);
            return (resolved - created) / (1000 * 60 * 60 * 24);
        });

        const ltStats = calcStats(leadTimes);
        const leadTimeWeeks = ltStats.avg / 7;

        // WIP
        const wipAtual = wipData.total;
        const wipIdeal = Math.max(1, Math.round(tpStats.avg * leadTimeWeeks));

        return {
            success: true,
            metrics: {
                throughput: {
                    average: tpStats.avg,
                    stdDev: tpStats.stdDev,
                    cov: tpStats.cov,
                    totalIssues: throughputData.total
                },
                leadTime: {
                    averageDays: ltStats.avg,
                    averageWeeks: Math.round(leadTimeWeeks * 10) / 10
                },
                wip: {
                    atual: wipAtual,
                    ideal: wipIdeal,
                    utilizationPercent: wipIdeal > 0 ? Math.round((wipAtual / wipIdeal) * 100) : 0
                }
            }
        };
    } catch (error) {
        console.error('Error fetching all metrics:', error);
        return { success: false, error: error.message };
    }
});

// ============================================================================
// STORAGE
// ============================================================================

resolver.define('saveConfig', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        await storage.set(`roadmap-config-${projectKey}`, payload.config);
        return { success: true };
    } catch (error) {
        console.error('Error saving config:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('loadConfig', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const config = await storage.get(`roadmap-config-${projectKey}`);
        return { success: true, config };
    } catch (error) {
        console.error('Error loading config:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('saveRoadmapData', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        await storage.set(`roadmap-data-${projectKey}`, payload.data);
        return { success: true };
    } catch (error) {
        console.error('Error saving roadmap data:', error);
        return { success: false, error: error.message };
    }
});

resolver.define('loadRoadmapData', async ({ payload, context }) => {
    try {
        const projectKey = context.extension.project.key;
        const data = await storage.get(`roadmap-data-${projectKey}`);
        return { success: true, data };
    } catch (error) {
        console.error('Error loading roadmap data:', error);
        return { success: false, error: error.message };
    }
});

export const handler = resolver.getDefinitions();