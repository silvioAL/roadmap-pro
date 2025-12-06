import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';
import jiraService from './jiraService';

// ============================================================================
// CONSTANTES PADRÃO
// ============================================================================

const SQUAD_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const DEFAULT_SERVICE_CLASSES = {
    standard: { name: 'Standard', color: '#3b82f6', icon: '⭐', cov: 0.30, description: 'Trabalho regular' },
    expedite: { name: 'Expedite', color: '#ef4444', icon: '🔥', cov: 0.50, description: 'Urgente' },
    fixed: { name: 'Fixed Date', color: '#f59e0b', icon: '📅', cov: 0.20, description: 'Data fixa' },
    intangible: { name: 'Intangible', color: '#8b5cf6', icon: '🔧', cov: 0.40, description: 'Tech debt' }
};

const DEFAULT_LINK_TYPE_MAPPING = {
    'Blocks': { inwardType: 'blockedBy', outwardType: 'blocks' },
    'Dependency': { inwardType: 'blockedBy', outwardType: 'blocks' },
    'Relates': { inwardType: 'relatedTo', outwardType: 'relatedTo' }
};

// ============================================================================
// FUNÇÕES UTILITÁRIAS
// ============================================================================

const generateId = () => Date.now() + Math.random();

const createDefaultSquad = (name, index = 0) => ({
    id: generateId(),
    name,
    color: SQUAD_COLORS[index % SQUAD_COLORS.length],
    throughput: 7,
    leadTime: 14,
    wipAtual: 0,
    classMetrics: {}
});

// Lei de Little: WIP Ideal = Throughput × Lead Time
const calculateWipIdeal = (squad) => {
    const throughput = squad.throughput || 5;
    const leadTimeWeeks = (squad.leadTime || 14) / 7;
    return Math.max(1, Math.round(throughput * leadTimeWeeks));
};

const getWipStatus = (squad) => {
    const wipIdeal = calculateWipIdeal(squad);
    const ratio = squad.wipAtual / wipIdeal;
    if (ratio <= 0.8) return 'ok';
    if (ratio <= 1.0) return 'warning';
    return 'danger';
};

const getWipStatusText = (squad) => {
    const wipIdeal = calculateWipIdeal(squad);
    const ratio = squad.wipAtual / wipIdeal;
    if (ratio <= 0.8) return 'Capacidade disponível';
    if (ratio <= 1.0) return 'Próximo do limite';
    return 'Acima do ideal';
};

const getTotalIssues = (item) => {
    if (item.useRealChildren && item.realChildCount !== undefined) {
        return item.realChildCount;
    }
    return item.estimatedIssues || 0;
};

const weeksToDate = (weeks, baseDate = new Date()) => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + weeks * 7);
    return d;
};

const dateToWeeks = (dateStr, baseDate = new Date()) => {
    if (!dateStr) return 0;
    const base = new Date(baseDate);
    base.setHours(0, 0, 0, 0);
    const target = new Date(dateStr);
    const diffMs = target - base;
    return diffMs / (7 * 24 * 60 * 60 * 1000);
};

const formatDate = (date) => {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const formatDateShort = (date) => {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

// Gera semanas para timeline (com suporte a scroll para passado)
const generateWeeks = (numWeeks = 52, offsetWeeks = 0) => {
    const weeks = [];
    const today = new Date();
    const baseDate = new Date(today);
    baseDate.setDate(today.getDate() - today.getDay() + 1 + (offsetWeeks * 7));

    for (let i = 0; i < numWeeks; i++) {
        const weekStart = new Date(baseDate);
        weekStart.setDate(weekStart.getDate() + (i * 7));
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weeks.push({
            index: i + offsetWeeks,
            start: weekStart,
            end: weekEnd,
            label: `S${i + 1 + offsetWeeks}`,
            dateLabel: formatDateShort(weekStart),
            isCurrentWeek: offsetWeeks === 0 && i === 0
        });
    }
    return weeks;
};

// Monte Carlo com distribuição log-normal
const monteCarloSimulation = (issues, throughput, cov, numSimulations = 10000) => {
    const results = [];

    for (let i = 0; i < numSimulations; i++) {
        const variance = Math.log(1 + cov * cov);
        const mu = Math.log(throughput) - variance / 2;
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const simulatedThroughput = Math.exp(mu + Math.sqrt(variance) * z);
        const weeksNeeded = issues / Math.max(0.1, simulatedThroughput);
        results.push(weeksNeeded);
    }

    results.sort((a, b) => a - b);

    return {
        p5: results[Math.floor(numSimulations * 0.05)],
        p50: results[Math.floor(numSimulations * 0.50)],
        p85: results[Math.floor(numSimulations * 0.85)],
        p95: results[Math.floor(numSimulations * 0.95)],
        results
    };
};

// Ordenação topológica com prioridade
const topologicalSortWithPriority = (items, allItems) => {
    const levels = new Map();
    const visited = new Set();

    const getLevel = (item) => {
        if (visited.has(item.id)) return levels.get(item.id) || 0;
        visited.add(item.id);

        let maxBlockerLevel = -1;

        (item.dependencies || [])
            .filter(d => d.type === 'blockedBy')
            .forEach(dep => {
                const blocker = allItems.find(e =>
                    String(e.id) === String(dep.targetId) ||
                    e.jiraKey === dep.targetKey
                );
                if (blocker) {
                    const blockerLevel = getLevel(blocker);
                    maxBlockerLevel = Math.max(maxBlockerLevel, blockerLevel);
                }
            });

        const level = maxBlockerLevel + 1;
        levels.set(item.id, level);
        return level;
    };

    items.forEach(item => getLevel(item));

    const sorted = [...items].sort((a, b) => {
        const levelA = levels.get(a.id) || 0;
        const levelB = levels.get(b.id) || 0;
        if (levelA !== levelB) return levelA - levelB;
        return (a.priority || 999) - (b.priority || 999);
    });

    return { sorted, levels };
};

// Algoritmo de lanes para evitar sobreposição na timeline
const calculateLanes = (items, timelineOffset) => {
    const lanes = [];
    const itemsWithLanes = [];

    // Ordena por data de início
    const sortedItems = [...items].sort((a, b) => {
        const startA = a.startWeekIndex || 0;
        const startB = b.startWeekIndex || 0;
        return startA - startB;
    });

    sortedItems.forEach(item => {
        const startWeek = item.startWeekIndex - timelineOffset;
        const endWeek = item.endWeekIndex - timelineOffset;

        // Encontra primeira lane disponível
        let assignedLane = -1;
        for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
            const lane = lanes[laneIdx];
            let canFit = true;

            for (const occupied of lane) {
                // Verifica sobreposição
                if (!(endWeek < occupied.start || startWeek > occupied.end)) {
                    canFit = false;
                    break;
                }
            }

            if (canFit) {
                assignedLane = laneIdx;
                break;
            }
        }

        // Se não encontrou lane, cria nova
        if (assignedLane === -1) {
            assignedLane = lanes.length;
            lanes.push([]);
        }

        // Marca período como ocupado nesta lane
        lanes[assignedLane].push({ start: startWeek, end: endWeek });

        itemsWithLanes.push({
            ...item,
            lane: assignedLane
        });
    });

    return { items: itemsWithLanes, totalLanes: lanes.length };
};

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================

function App() {
    // Estado Principal
    const [squads, setSquads] = useState([]);
    const [items, setItems] = useState([]);
    const [currentView, setCurrentView] = useState('planning');
    const [results, setResults] = useState(null);
    const [toast, setToast] = useState(null);
    const [loading, setLoading] = useState(false);

    // Estado Jira
    const [jiraConnected, setJiraConnected] = useState(false);
    const [projectInfo, setProjectInfo] = useState(null);
    const [issueTypes, setIssueTypes] = useState([]);
    const [linkTypes, setLinkTypes] = useState([]);
    const [jiraIssues, setJiraIssues] = useState([]);

    // Configuração do usuário
    const [config, setConfig] = useState({
        simulations: 10000,
        autoSimulate: true,
        targetLoad: 100,
        respectDependencies: true,
        hierarchyConfig: {
            enabled: false,
            levels: []
        },
        serviceClasses: { ...DEFAULT_SERVICE_CLASSES },
        linkTypeMapping: { ...DEFAULT_LINK_TYPE_MAPPING },
        issueCountField: 'estimatedIssues'
    });

    // Estado dos Modais
    const [showSquadModal, setShowSquadModal] = useState(false);
    const [showItemModal, setShowItemModal] = useState(false);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [editingSquad, setEditingSquad] = useState(null);
    const [editingItem, setEditingItem] = useState(null);
    const [formData, setFormData] = useState({});

    // Estado do Timeline
    const [timelineOffset, setTimelineOffset] = useState(0);
    const timelineRef = useRef(null);

    // Estado das Métricas
    const [metricsData, setMetricsData] = useState({
        loaded: false,
        loading: false,
        wipHistory: [], // Array de { week, squadId, wipAtual, wipIdeal }
        throughputHistory: [], // Array de { week, squadId, value }
        leadTimeHistory: [], // Array de { week, squadId, value }
        currentMetrics: null
    });

    // ============================================================================
    // TOAST
    // ============================================================================

    const showToast = useCallback((message, type = 'info') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    // ============================================================================
    // INICIALIZAÇÃO E JIRA
    // ============================================================================

    useEffect(() => {
        const initializeApp = async () => {
            setLoading(true);
            try {
                // Carregar configuração salva
                const configResult = await jiraService.loadConfig();
                if (configResult.success && configResult.config) {
                    setConfig(prev => ({ ...prev, ...configResult.config }));
                }

                // Carregar dados do roadmap salvos
                const dataResult = await jiraService.loadRoadmapData();
                if (dataResult.success && dataResult.data) {
                    if (dataResult.data.squads) setSquads(dataResult.data.squads);
                    if (dataResult.data.items) setItems(dataResult.data.items);
                }

                // Buscar tipos de issue
                const typesResult = await jiraService.getIssueTypes();
                if (typesResult.success) {
                    setProjectInfo({
                        key: typesResult.projectKey,
                        id: typesResult.projectId,
                        name: typesResult.projectName
                    });
                    setIssueTypes(typesResult.issueTypes);
                    setJiraConnected(true);
                }

                // Buscar tipos de link
                const linksResult = await jiraService.getLinkTypes();
                if (linksResult.success) {
                    setLinkTypes(linksResult.linkTypes);
                }

            } catch (error) {
                console.error('Initialization error:', error);
                showToast('⚠️ Erro ao conectar com Jira', 'error');
            }
            setLoading(false);
        };

        initializeApp();
    }, [showToast]);

    // Buscar métricas reais do Jira
    const loadMetricsFromJira = useCallback(async () => {
        if (!jiraConnected) return;

        setMetricsData(prev => ({ ...prev, loading: true }));
        try {
            // Buscar métricas gerais
            const result = await jiraService.getAllMetrics(
                config.hierarchyConfig.levels.length > 0 ? config.hierarchyConfig.levels : null,
                12
            );

            if (result.success && result.metrics) {
                // Buscar histórico de throughput
                const throughputResult = await jiraService.getThroughputHistory(12);

                // Buscar histórico de WIP (simulado por semana se não houver endpoint específico)
                const wipHistory = [];
                const throughputHistory = [];

                if (throughputResult.success && throughputResult.weeklyData) {
                    throughputResult.weeklyData.forEach((weekData, idx) => {
                        const weekLabel = `S${idx + 1}`;

                        // Throughput por semana
                        throughputHistory.push({
                            week: weekLabel,
                            weekStart: weekData.weekStart,
                            value: weekData.count
                        });

                        // Calcular WIP ideal baseado no throughput e lead time médio
                        const wipIdeal = calculateWipIdeal({
                            throughput: result.metrics.throughput.average,
                            leadTime: result.metrics.leadTime.averageDays
                        });

                        // WIP por semana (estimativa baseada no throughput)
                        // Em produção, isso viria de snapshots históricos
                        wipHistory.push({
                            week: weekLabel,
                            weekStart: weekData.weekStart,
                            wipAtual: result.metrics.wip.atual, // Valor atual (snapshot)
                            wipIdeal: wipIdeal
                        });
                    });
                }

                setMetricsData({
                    loaded: true,
                    loading: false,
                    wipHistory,
                    throughputHistory,
                    leadTimeHistory: [],
                    currentMetrics: result.metrics
                });

                // Atualiza squads com métricas atuais
                if (squads.length > 0) {
                    setSquads(prev => prev.map((squad, idx) =>
                        idx === 0 ? {
                            ...squad,
                            throughput: result.metrics.throughput.average || squad.throughput,
                            leadTime: result.metrics.leadTime.averageDays || squad.leadTime,
                            wipAtual: result.metrics.wip.atual || squad.wipAtual,
                            cov: result.metrics.throughput.cov || 0.3
                        } : squad
                    ));
                }

                showToast(`✅ Métricas carregadas`, 'success');
            }
        } catch (error) {
            console.error('Error loading metrics:', error);
            setMetricsData(prev => ({ ...prev, loading: false }));
            showToast('❌ Erro ao buscar métricas', 'error');
        }
    }, [jiraConnected, config.hierarchyConfig.levels, squads.length, showToast]);

    // Auto-save
    useEffect(() => {
        if (squads.length > 0 || items.length > 0) {
            const saveTimeout = setTimeout(async () => {
                await jiraService.saveRoadmapData({ squads, items });
                await jiraService.saveConfig(config);
            }, 1000);
            return () => clearTimeout(saveTimeout);
        }
    }, [squads, items, config]);

    // Importar issues do Jira
    const importFromJira = async () => {
        if (!config.hierarchyConfig.enabled || config.hierarchyConfig.levels.length === 0) {
            showToast('⚠️ Configure a hierarquia primeiro', 'warning');
            setShowConfigModal(true);
            return;
        }

        setLoading(true);
        try {
            console.log('=== Importando do Jira ===');
            console.log('Níveis configurados:', config.hierarchyConfig.levels);

            const result = await jiraService.searchIssues(
                config.hierarchyConfig.levels,
                200
            );

            console.log('Resultado da busca:', result);

            if (result.success) {
                setJiraIssues(result.issues);
                setShowImportModal(true);
                showToast(`✅ ${result.issues.length} issues encontradas`, 'success');
            } else {
                // Mostrar erro detalhado
                console.error('Erro na busca:', result.error);
                showToast(`❌ Erro: ${result.error || 'Erro desconhecido'}`, 'error');
            }
        } catch (error) {
            console.error('Exceção ao importar:', error);
            showToast(`❌ Exceção: ${error.message}`, 'error');
        }
        setLoading(false);
    };

    // Confirmar importação de issues selecionadas
    const confirmImport = async (selectedIssues) => {
        setLoading(true);

        const newItems = [];
        const projectsMap = new Map(); // Para rastrear projetos únicos

        for (const issue of selectedIssues) {
            let realChildCount = 0;
            let childStats = { todo: 0, inProgress: 0, done: 0 };

            const countResult = await jiraService.countChildIssues(issue.key, true);
            if (countResult.success) {
                realChildCount = countResult.total;
                childStats = {
                    todo: countResult.todo,
                    inProgress: countResult.inProgress,
                    done: countResult.done
                };
            }

            const dependencies = jiraService.extractDependencies
                ? jiraService.extractDependencies(issue.links, config.linkTypeMapping)
                : [];

            // Identificar projeto da issue
            const projectKey = issue.key.split('-')[0];
            if (!projectsMap.has(projectKey)) {
                projectsMap.set(projectKey, {
                    key: projectKey,
                    name: projectKey, // Será atualizado se tivermos o nome completo
                    issues: []
                });
            }

            const itemId = generateId();
            projectsMap.get(projectKey).issues.push(itemId);

            newItems.push({
                id: itemId,
                jiraId: issue.id,
                jiraKey: issue.key,
                projectKey: projectKey,
                name: issue.summary,
                type: issue.type.name,
                typeIcon: issue.type.iconUrl,
                hierarchyLevel: issue.type.hierarchyLevel,
                status: issue.status,
                priority: issue.priority?.name ? getPriorityNumber(issue.priority.name) : 999,
                parentKey: issue.parent?.key,
                parentId: issue.parent?.id,
                serviceClass: 'standard',
                estimatedIssues: realChildCount || 10,
                realChildCount,
                childStats,
                useRealChildren: realChildCount > 0,
                squadAllocations: [], // Será preenchido após criar squads
                dependencies,
                selected: true,
                labels: issue.labels
            });
        }

        // Criar squads automaticamente baseado nos projetos
        const newSquads = [];
        let colorIndex = squads.length;

        projectsMap.forEach((project, projectKey) => {
            // Verificar se já existe squad para este projeto
            const existingSquad = squads.find(s => s.projectKey === projectKey || s.name === projectKey);

            if (!existingSquad) {
                const newSquad = {
                    id: generateId(),
                    projectKey: projectKey,
                    name: project.name || projectKey,
                    color: SQUAD_COLORS[colorIndex % SQUAD_COLORS.length],
                    throughput: 7,
                    leadTime: 14,
                    wipAtual: 0,
                    classMetrics: {}
                };
                newSquads.push(newSquad);
                colorIndex++;

                // Atualizar itens com alocação para esta squad
                project.issues.forEach(itemId => {
                    const item = newItems.find(i => i.id === itemId);
                    if (item) {
                        item.squadAllocations = [{ squadId: newSquad.id, percentage: 100, startDate: null }];
                    }
                });
            } else {
                // Usar squad existente
                project.issues.forEach(itemId => {
                    const item = newItems.find(i => i.id === itemId);
                    if (item) {
                        item.squadAllocations = [{ squadId: existingSquad.id, percentage: 100, startDate: null }];
                    }
                });
            }
        });

        // Atualizar estado
        if (newSquads.length > 0) {
            setSquads(prev => [...prev, ...newSquads]);
        }
        setItems(prev => [...prev, ...newItems]);
        setShowImportModal(false);

        const msg = newSquads.length > 0
            ? `✅ ${newItems.length} itens importados, ${newSquads.length} projeto(s) criado(s)`
            : `✅ ${newItems.length} itens importados`;
        showToast(msg, 'success');
        setLoading(false);
    };

    const getPriorityNumber = (priorityName) => {
        const priorities = { 'Highest': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Lowest': 5 };
        return priorities[priorityName] || 999;
    };

    // Atualizar contagem de children reais
    const refreshChildCount = async (itemId) => {
        const item = items.find(i => i.id === itemId);
        if (!item || !item.jiraKey) return;

        const result = await jiraService.countChildIssues(item.jiraKey, true);
        if (result.success) {
            setItems(prev => prev.map(i =>
                i.id === itemId
                    ? {
                        ...i,
                        realChildCount: result.total,
                        childStats: {
                            todo: result.todo,
                            inProgress: result.inProgress,
                            done: result.done
                        }
                    }
                    : i
            ));
            showToast(`✅ ${item.jiraKey}: ${result.total} issues`, 'success');
        }
    };

    // ============================================================================
    // COMPUTED VALUES
    // ============================================================================

    const selectedItems = useMemo(() => items.filter(i => i.selected), [items]);
    const totalSelectedIssues = useMemo(() =>
            selectedItems.reduce((sum, i) => sum + getTotalIssues(i), 0),
        [selectedItems]
    );

    const availableTypes = useMemo(() => {
        if (config.hierarchyConfig.enabled && config.hierarchyConfig.levels.length > 0) {
            return config.hierarchyConfig.levels;
        }
        return issueTypes.map(t => t.name);
    }, [config.hierarchyConfig, issueTypes]);

    // ============================================================================
    // SQUAD FUNCTIONS
    // ============================================================================

    const openAddSquadModal = () => {
        setEditingSquad(null);
        setFormData({
            name: '',
            throughput: 7,
            leadTime: 14,
            wipAtual: 0,
            color: SQUAD_COLORS[squads.length % SQUAD_COLORS.length],
            classMetrics: {}
        });
        setShowSquadModal(true);
    };

    const openEditSquadModal = (squad) => {
        setEditingSquad(squad);
        setFormData({ ...squad });
        setShowSquadModal(true);
    };

    const saveSquad = () => {
        if (!formData.name) {
            showToast('❌ Informe o nome da squad', 'error');
            return;
        }

        const squadData = {
            ...formData,
            id: editingSquad ? editingSquad.id : generateId(),
            throughput: parseFloat(formData.throughput) || 7,
            leadTime: parseInt(formData.leadTime) || 14,
            wipAtual: parseInt(formData.wipAtual) || 0
        };

        if (editingSquad) {
            setSquads(prev => prev.map(s => s.id === editingSquad.id ? squadData : s));
            showToast('✅ Squad atualizada', 'success');
        } else {
            setSquads(prev => [...prev, squadData]);
            showToast('✅ Squad adicionada', 'success');
        }
        setShowSquadModal(false);
    };

    const deleteSquad = (id) => {
        if (!window.confirm('Deletar esta squad?')) return;
        setSquads(prev => prev.filter(s => s.id !== id));
        setItems(prev => prev.map(item => ({
            ...item,
            squadAllocations: (item.squadAllocations || []).filter(a => a.squadId !== id)
        })));
        showToast('🗑️ Squad removida', 'success');
    };

    // Atualizar WIP da squad via Jira
    const refreshSquadWip = async (squadId) => {
        const result = await jiraService.getCurrentWip();
        if (result.success) {
            setSquads(prev => prev.map(s =>
                s.id === squadId ? { ...s, wipAtual: result.wip } : s
            ));
            showToast('✅ WIP atualizado', 'success');
        }
    };

    // ============================================================================
    // ITEM FUNCTIONS
    // ============================================================================

    const openAddItemModal = (type = null) => {
        if (squads.length === 0) {
            showToast('❌ Adicione uma squad primeiro', 'error');
            return;
        }
        setEditingItem(null);
        setFormData({
            name: '',
            type: type || availableTypes[0] || 'Epic',
            serviceClass: 'standard',
            priority: items.length + 1,
            estimatedIssues: 10,
            useRealChildren: false,
            realChildCount: 0,
            squadAllocations: [{ squadId: squads[0].id, percentage: 100, startDate: null }],
            dependencies: []
        });
        setShowItemModal(true);
    };

    const openEditItemModal = (item) => {
        setEditingItem(item);
        setFormData({ ...item });
        setShowItemModal(true);
    };

    const saveItem = () => {
        if (!formData.name) {
            showToast('❌ Informe o nome do item', 'error');
            return;
        }

        const itemData = {
            ...formData,
            id: editingItem ? editingItem.id : generateId(),
            selected: formData.selected !== undefined ? formData.selected : true,
            priority: parseInt(formData.priority) || 999,
            estimatedIssues: parseInt(formData.estimatedIssues) || 10,
            squadAllocations: (formData.squadAllocations || []).map(a => ({
                ...a,
                percentage: parseInt(a.percentage) || 100,
                squadId: typeof a.squadId === 'string' ? parseFloat(a.squadId) : a.squadId
            }))
        };

        if (editingItem) {
            setItems(prev => prev.map(i => i.id === editingItem.id ? itemData : i));
            showToast('✅ Item atualizado', 'success');
        } else {
            setItems(prev => [...prev, itemData]);
            showToast('✅ Item adicionado', 'success');
        }
        setShowItemModal(false);
    };

    const deleteItem = (id) => {
        if (!window.confirm('Deletar este item?')) return;
        setItems(prev => prev.filter(i => i.id !== id));
        showToast('🗑️ Item removido', 'success');
    };

    const toggleItemSelection = (id) => {
        setItems(prev => prev.map(i =>
            i.id === id ? { ...i, selected: !i.selected } : i
        ));
    };

    // Allocation helpers
    const addAllocation = () => {
        if (squads.length === 0) return;
        setFormData(prev => ({
            ...prev,
            squadAllocations: [
                ...(prev.squadAllocations || []),
                { squadId: squads[0].id, percentage: 100, startDate: null }
            ]
        }));
    };

    const updateAllocation = (index, field, value) => {
        setFormData(prev => {
            const allocs = [...(prev.squadAllocations || [])];
            allocs[index] = { ...allocs[index], [field]: value };
            return { ...prev, squadAllocations: allocs };
        });
    };

    const removeAllocation = (index) => {
        setFormData(prev => ({
            ...prev,
            squadAllocations: (prev.squadAllocations || []).filter((_, i) => i !== index)
        }));
    };

    // Dependency helpers
    const addDependency = () => {
        setFormData(prev => ({
            ...prev,
            dependencies: [
                ...(prev.dependencies || []),
                { targetKey: '', type: 'blockedBy' }
            ]
        }));
    };

    const updateDependency = (index, field, value) => {
        setFormData(prev => {
            const deps = [...(prev.dependencies || [])];
            deps[index] = { ...deps[index], [field]: value };
            return { ...prev, dependencies: deps };
        });
    };

    const removeDependency = (index) => {
        setFormData(prev => ({
            ...prev,
            dependencies: (prev.dependencies || []).filter((_, i) => i !== index)
        }));
    };

    // ============================================================================
    // SIMULAÇÃO MONTE CARLO
    // ============================================================================

    const runSimulation = useCallback(() => {
        if (selectedItems.length === 0) {
            showToast('❌ Selecione itens para simular', 'error');
            return;
        }
        if (squads.length === 0) {
            showToast('❌ Adicione squads', 'error');
            return;
        }

        const numSims = config.simulations;
        const projections = [];
        const allResults = [];

        selectedItems.forEach(item => {
            const totalIssues = getTotalIssues(item);
            const serviceClass = config.serviceClasses[item.serviceClass] || DEFAULT_SERVICE_CLASSES.standard;

            (item.squadAllocations || []).forEach(alloc => {
                const squad = squads.find(s => s.id === alloc.squadId);
                if (!squad || totalIssues === 0) return;

                const allocatedIssues = totalIssues * (alloc.percentage / 100);
                const cov = squad.classMetrics?.[item.serviceClass]?.cov || serviceClass.cov;

                const sim = monteCarloSimulation(allocatedIssues, squad.throughput, cov, numSims);

                const startWeeks = dateToWeeks(alloc.startDate);

                projections.push({
                    item,
                    squad,
                    issues: allocatedIssues,
                    startDate: alloc.startDate,
                    startWeeks,
                    p5: startWeeks + sim.p5,
                    p50: startWeeks + sim.p50,
                    p85: startWeeks + sim.p85,
                    p95: startWeeks + sim.p95,
                    cov
                });

                sim.results.forEach(r => allResults.push(startWeeks + r));
            });
        });

        allResults.sort((a, b) => a - b);

        const p5 = allResults[Math.floor(allResults.length * 0.05)] || 0;
        const p50 = allResults[Math.floor(allResults.length * 0.50)] || 0;
        const p85 = allResults[Math.floor(allResults.length * 0.85)] || 0;
        const p95 = allResults[Math.floor(allResults.length * 0.95)] || 0;

        setResults({
            projections,
            allResults,
            p5, p50, p85, p95,
            numSims,
            originalTotal: totalSelectedIssues
        });

        setCurrentView('results');
        showToast('✅ Simulação concluída', 'success');
    }, [selectedItems, squads, config, totalSelectedIssues, showToast]);

    // ============================================================================
    // EXPORT/IMPORT
    // ============================================================================

    const exportData = () => {
        const data = { squads, items, config, exportDate: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `roadmap-${projectInfo?.key || 'export'}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('💾 Dados exportados', 'success');
    };

    const importData = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.squads) setSquads(data.squads);
                if (data.items) setItems(data.items);
                if (data.config) setConfig(prev => ({ ...prev, ...data.config }));
                showToast('✅ Dados importados', 'success');
            } catch {
                showToast('❌ Arquivo inválido', 'error');
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    };

    const clearAllData = () => {
        if (!window.confirm('Limpar TODOS os dados?')) return;
        setSquads([]);
        setItems([]);
        setResults(null);
        showToast('🗑️ Dados limpos', 'success');
    };

    // ============================================================================
    // RENDER
    // ============================================================================

    return (
        <div className="app">
            {/* Loading Overlay */}
            {loading && (
                <div className="loading-overlay">
                    <div className="loading-spinner" />
                    <span>Carregando...</span>
                </div>
            )}

            {/* Toast */}
            {toast && <div className={`toast show ${toast.type}`}>{toast.message}</div>}

            {/* Header */}
            <header className="header">
                <div className="header-content">
                    <h1>🎯 Roadmap Forecaster Pro</h1>
                    <div className="header-subtitle">
                        {projectInfo ? (
                            <span className="project-badge">📂 {projectInfo.name} ({projectInfo.key})</span>
                        ) : (
                            <span>Projeção Monte Carlo Multi-Squad</span>
                        )}
                        <span className="config-info">• {config.simulations.toLocaleString()} iterações</span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn btn-jira" onClick={() => setShowConfigModal(true)}>
                        ⚙️ Configurar
                    </button>
                    <button className="btn btn-jira" onClick={importFromJira} disabled={!jiraConnected}>
                        🔄 Importar Jira
                    </button>
                    <button className="btn btn-secondary" onClick={exportData}>💾 Exportar</button>
                    <label className="btn btn-secondary">
                        📁 Importar
                        <input type="file" accept=".json" onChange={importData} style={{display: 'none'}} />
                    </label>
                    <button className="btn btn-danger-outline" onClick={clearAllData}>🗑️</button>
                </div>
            </header>

            {/* View Selector */}
            <nav className="view-selector">
                <button className={`view-btn ${currentView === 'planning' ? 'active' : ''}`} onClick={() => setCurrentView('planning')}>
                    📋 Planejamento
                </button>
                <button className={`view-btn ${currentView === 'queue' ? 'active' : ''}`} onClick={() => setCurrentView('queue')}>
                    📊 Filas (PCP)
                </button>
                <button className={`view-btn ${currentView === 'timeline' ? 'active' : ''}`} onClick={() => setCurrentView('timeline')}>
                    📅 Timeline
                </button>
                <button className={`view-btn ${currentView === 'heatmap' ? 'active' : ''}`} onClick={() => setCurrentView('heatmap')}>
                    🔥 Heatmap
                </button>
                <button className={`view-btn ${currentView === 'results' ? 'active' : ''}`} onClick={() => setCurrentView('results')}>
                    📈 Resultados
                </button>
                <button className={`view-btn ${currentView === 'metrics' ? 'active' : ''}`} onClick={() => setCurrentView('metrics')}>
                    📉 Métricas
                </button>
            </nav>

            {/* =========== PLANNING VIEW =========== */}
            {currentView === 'planning' && (
                <div className="planning-view">
                    {/* Header da View */}
                    <div className="planning-header">
                        <div className="planning-title-section">
                            <h1>📋 Planejamento de Roadmap</h1>
                            <p className="planning-subtitle">
                                {projectInfo
                                    ? `Projeto: ${projectInfo.name} (${projectInfo.key})`
                                    : 'Configure o projeto no Jira'}
                            </p>
                        </div>
                        <div className="planning-actions">
                            <button className="btn btn-secondary" onClick={() => setShowConfigModal(true)}>
                                ⚙️ Configurar Hierarquia
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={importFromJira}
                                disabled={!jiraConnected || !config.hierarchyConfig.enabled}
                            >
                                🔄 Importar do Jira
                            </button>
                        </div>
                    </div>

                    {/* Seleção de Nível Hierárquico */}
                    {!config.hierarchyConfig.enabled && (
                        <div className="hierarchy-setup-card">
                            <div className="setup-icon">🏗️</div>
                            <h3>Configure o Nível Hierárquico</h3>
                            <p>Selecione qual nível de itens você deseja trabalhar no roadmap:</p>
                            <div className="hierarchy-options">
                                {/* Botão Iniciativas - busca dinamicamente */}
                                {(() => {
                                    const initiative = issueTypes.find(t => t.hierarchyLevel === 2);
                                    if (!initiative) return null;
                                    return (
                                        <button
                                            className="hierarchy-option"
                                            onClick={() => {
                                                setConfig(prev => ({
                                                    ...prev,
                                                    hierarchyConfig: { enabled: true, levels: [initiative.name] }
                                                }));
                                                showToast(`✅ Nível definido: ${initiative.name}`, 'success');
                                            }}
                                        >
                                            <span className="option-icon">🎯</span>
                                            <span className="option-title">{initiative.name}</span>
                                            <span className="option-desc">Grandes objetivos estratégicos</span>
                                        </button>
                                    );
                                })()}

                                {/* Botão Épicos - busca dinamicamente */}
                                {(() => {
                                    const epic = issueTypes.find(t => t.hierarchyLevel === 1);
                                    if (!epic) return null;
                                    return (
                                        <button
                                            className="hierarchy-option"
                                            onClick={() => {
                                                setConfig(prev => ({
                                                    ...prev,
                                                    hierarchyConfig: { enabled: true, levels: [epic.name] }
                                                }));
                                                showToast(`✅ Nível definido: ${epic.name}`, 'success');
                                            }}
                                        >
                                            <span className="option-icon">📦</span>
                                            <span className="option-title">{epic.name}</span>
                                            <span className="option-desc">Funcionalidades e entregas</span>
                                        </button>
                                    );
                                })()}

                                {/* Fallback se não encontrar tipos por hierarquia */}
                                {!issueTypes.some(t => t.hierarchyLevel >= 1) && issueTypes.length > 0 && (
                                    <p style={{color: '#64748b', fontSize: '14px'}}>
                                        Use a configuração avançada para selecionar os tipos de issue.
                                    </p>
                                )}
                            </div>
                            <button
                                className="btn btn-link"
                                onClick={() => setShowConfigModal(true)}
                            >
                                Configuração avançada →
                            </button>
                        </div>
                    )}

                    {/* Resumo de Projetos (Squads) - Mostra automaticamente */}
                    {squads.length > 0 && (
                        <div className="projects-summary">
                            <h3>📊 Projetos no Roadmap</h3>
                            <div className="projects-grid">
                                {squads.map(squad => {
                                    const wipIdeal = calculateWipIdeal(squad);
                                    const wipStatus = getWipStatus(squad);
                                    const itemCount = items.filter(i =>
                                        (i.squadAllocations || []).some(a => a.squadId === squad.id)
                                    ).length;

                                    return (
                                        <div key={squad.id} className="project-summary-card">
                                            <div className="project-header">
                                                <span className="project-color" style={{background: squad.color}} />
                                                <span className="project-name">{squad.name}</span>
                                                <span className={`project-status ${wipStatus}`}>
                                                    {wipStatus === 'ok' ? '✓' : wipStatus === 'warning' ? '⚠' : '🔥'}
                                                </span>
                                            </div>
                                            <div className="project-stats">
                                                <span>{itemCount} itens</span>
                                                <span>•</span>
                                                <span>TP: {squad.throughput}/sem</span>
                                                <span>•</span>
                                                <span>WIP: {squad.wipAtual}/{wipIdeal}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Lista de Itens */}
                    <div className="items-section">
                        <div className="items-header">
                            <div className="items-title">
                                <h2>
                                    {config.hierarchyConfig.levels?.[0] === 'Initiative' ? '🎯 Iniciativas' : '📦 Épicos'}
                                    <span className="items-count">({items.length})</span>
                                </h2>
                                {config.hierarchyConfig.enabled && (
                                    <span className="hierarchy-badge">
                                        Nível: {config.hierarchyConfig.levels?.join(', ') || 'Não definido'}
                                    </span>
                                )}
                            </div>
                            <div className="items-actions">
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => setItems(prev => prev.map(i => ({...i, selected: true})))}
                                    disabled={items.length === 0}
                                >
                                    ✓ Selecionar Todos
                                </button>
                                <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => setItems(prev => prev.map(i => ({...i, selected: false})))}
                                    disabled={items.length === 0}
                                >
                                    ✕ Limpar Seleção
                                </button>
                            </div>
                        </div>

                        {items.length === 0 ? (
                            <div className="empty-items-state">
                                <div className="empty-icon">
                                    {config.hierarchyConfig.enabled ? '📥' : '🏗️'}
                                </div>
                                <h3>
                                    {config.hierarchyConfig.enabled
                                        ? 'Nenhum item importado'
                                        : 'Configure o nível hierárquico'}
                                </h3>
                                <p>
                                    {config.hierarchyConfig.enabled
                                        ? `Clique em "Importar do Jira" para buscar ${config.hierarchyConfig.levels?.[0] || 'itens'}`
                                        : 'Selecione se deseja trabalhar com Iniciativas ou Épicos'}
                                </p>
                                {config.hierarchyConfig.enabled && (
                                    <button
                                        className="btn btn-primary"
                                        onClick={importFromJira}
                                        disabled={!jiraConnected}
                                    >
                                        🔄 Importar do Jira
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="items-list">
                                {items.map(item => (
                                    <ItemRow
                                        key={item.id}
                                        item={item}
                                        items={items}
                                        squads={squads}
                                        serviceClasses={config.serviceClasses}
                                        onToggle={toggleItemSelection}
                                        onEdit={openEditItemModal}
                                        onDelete={deleteItem}
                                        onRefreshCount={refreshChildCount}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Simulation Controls */}
                    {items.length > 0 && (
                        <div className="simulation-section">
                            <div className="simulation-header">
                                <h3>🎲 Simulação Monte Carlo</h3>
                                <div className="simulation-stats">
                                    <span className="stat-item">
                                        <span className="stat-value">{selectedItems.length}</span>
                                        <span className="stat-label">itens selecionados</span>
                                    </span>
                                    <span className="stat-item">
                                        <span className="stat-value">{totalSelectedIssues}</span>
                                        <span className="stat-label">issues total</span>
                                    </span>
                                </div>
                            </div>
                            <div className="simulation-controls">
                                <div className="control-group">
                                    <label>Iterações:</label>
                                    <select
                                        value={config.simulations}
                                        onChange={e => setConfig({...config, simulations: parseInt(e.target.value)})}
                                    >
                                        <option value={1000}>1.000</option>
                                        <option value={5000}>5.000</option>
                                        <option value={10000}>10.000</option>
                                        <option value={50000}>50.000</option>
                                    </select>
                                </div>
                                <button
                                    className="btn btn-success btn-lg"
                                    onClick={runSimulation}
                                    disabled={selectedItems.length === 0}
                                >
                                    🚀 Executar Simulação
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* =========== QUEUE VIEW =========== */}
            {currentView === 'queue' && (
                <QueueView
                    squads={squads}
                    items={items}
                    selectedItems={selectedItems}
                    serviceClasses={config.serviceClasses}
                    onEditItem={openEditItemModal}
                />
            )}

            {/* =========== TIMELINE VIEW =========== */}
            {currentView === 'timeline' && (
                <TimelineView
                    squads={squads}
                    items={items}
                    selectedItems={selectedItems}
                    config={config}
                    timelineOffset={timelineOffset}
                    setTimelineOffset={setTimelineOffset}
                    timelineRef={timelineRef}
                />
            )}

            {/* =========== HEATMAP VIEW =========== */}
            {currentView === 'heatmap' && (
                <HeatmapView
                    squads={squads}
                    items={items}
                    selectedItems={selectedItems}
                    timelineOffset={timelineOffset}
                    setTimelineOffset={setTimelineOffset}
                />
            )}

            {/* =========== RESULTS VIEW =========== */}
            {currentView === 'results' && (
                <ResultsView
                    results={results}
                    squads={squads}
                    serviceClasses={config.serviceClasses}
                    onRunSimulation={runSimulation}
                />
            )}

            {/* =========== METRICS VIEW =========== */}
            {currentView === 'metrics' && (
                <MetricsView
                    squads={squads}
                    metricsData={metricsData}
                    jiraConnected={jiraConnected}
                    onLoadMetrics={loadMetricsFromJira}
                    calculateWipIdeal={calculateWipIdeal}
                />
            )}

            {/* =========== MODALS =========== */}

            {/* Squad Modal */}
            {showSquadModal && (
                <Modal title={editingSquad ? '✏️ Editar Squad' : '➕ Nova Squad'} onClose={() => setShowSquadModal(false)}>
                    <SquadForm
                        formData={formData}
                        setFormData={setFormData}
                        serviceClasses={config.serviceClasses}
                    />
                    <div className="modal-footer">
                        <button className="btn" onClick={() => setShowSquadModal(false)}>Cancelar</button>
                        <button className="btn btn-primary" onClick={saveSquad}>Salvar</button>
                    </div>
                </Modal>
            )}

            {/* Item Modal */}
            {showItemModal && (
                <Modal
                    title={editingItem ? `✏️ Editar ${formData.type || 'Item'}` : `➕ Novo ${formData.type || 'Item'}`}
                    onClose={() => setShowItemModal(false)}
                    large
                >
                    <ItemForm
                        formData={formData}
                        setFormData={setFormData}
                        availableTypes={availableTypes}
                        squads={squads}
                        items={items}
                        serviceClasses={config.serviceClasses}
                        linkTypes={linkTypes}
                        addAllocation={addAllocation}
                        updateAllocation={updateAllocation}
                        removeAllocation={removeAllocation}
                        addDependency={addDependency}
                        updateDependency={updateDependency}
                        removeDependency={removeDependency}
                    />
                    <div className="modal-footer">
                        <button className="btn" onClick={() => setShowItemModal(false)}>Cancelar</button>
                        <button className="btn btn-primary" onClick={saveItem}>Salvar</button>
                    </div>
                </Modal>
            )}

            {/* Config Modal */}
            {showConfigModal && (
                <Modal title="⚙️ Configuração Jira" onClose={() => setShowConfigModal(false)} large>
                    <ConfigForm
                        config={config}
                        setConfig={setConfig}
                        issueTypes={issueTypes}
                        linkTypes={linkTypes}
                        showToast={showToast}
                    />
                    <div className="modal-footer">
                        <button className="btn" onClick={() => setShowConfigModal(false)}>Fechar</button>
                    </div>
                </Modal>
            )}

            {/* Import Modal */}
            {showImportModal && (
                <Modal title="🔄 Importar do Jira" onClose={() => setShowImportModal(false)} large>
                    <ImportForm
                        issues={jiraIssues}
                        onConfirm={confirmImport}
                        onCancel={() => setShowImportModal(false)}
                    />
                </Modal>
            )}
        </div>
    );
}

// ============================================================================
// SUB-COMPONENTES
// ============================================================================

function Modal({ title, children, onClose, large }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className={`modal ${large ? 'modal-large' : ''}`} onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{title}</h2>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
}

function ItemRow({ item, items, squads, serviceClasses, onToggle, onEdit, onDelete, onRefreshCount }) {
    const totalIssues = getTotalIssues(item);
    const serviceClass = serviceClasses[item.serviceClass] || DEFAULT_SERVICE_CLASSES.standard;
    const deps = (item.dependencies || []).filter(d => d.type === 'blockedBy');
    const progress = item.childStats
        ? Math.round((item.childStats.done / (item.childStats.todo + item.childStats.inProgress + item.childStats.done)) * 100) || 0
        : 0;

    return (
        <div className={`list-item ${item.selected ? 'selected' : ''}`}>
            <div className="list-item-checkbox">
                <input type="checkbox" checked={item.selected || false} onChange={() => onToggle(item.id)} />
            </div>
            <div className="list-item-content">
                <div className="list-item-title">
          <span className={`service-badge`} style={{background: serviceClass.color + '20', color: serviceClass.color}}>
            {serviceClass.icon}
          </span>
                    {item.jiraKey && <span className="jira-key">{item.jiraKey}</span>}
                    <span className="item-type-tag">{item.type}</span>
                    <span>{item.name}</span>
                    {deps.length > 0 && <span className="dep-badge">🔗 {deps.length}</span>}
                </div>
                <div className="list-item-meta">
          <span className="issue-count">
            {item.useRealChildren ? '📊' : '✏️'} {totalIssues} issues
              {item.useRealChildren && item.realChildCount > 0 && (
                  <span className="child-progress">
                ({item.childStats?.done || 0}/{item.realChildCount} done)
              </span>
              )}
          </span>
                    {item.status && (
                        <span className={`status-badge status-${item.status.category}`}>
              {item.status.name}
            </span>
                    )}
                    {(item.squadAllocations || []).map((alloc, idx) => {
                        const squad = squads.find(s => s.id === alloc.squadId);
                        return squad ? (
                            <span key={idx} className="allocation-tag">
                <span className="color-dot-small" style={{background: squad.color}} />
                                {squad.name} ({alloc.percentage}%)
              </span>
                        ) : null;
                    })}
                </div>
            </div>
            <div className="list-item-actions">
                {item.jiraKey && (
                    <button className="btn-icon" onClick={() => onRefreshCount(item.id)} title="Atualizar contagem">🔄</button>
                )}
                <button className="btn-icon" onClick={() => onEdit(item)}>✏️</button>
                <button className="btn-icon danger" onClick={() => onDelete(item.id)}>🗑️</button>
            </div>
        </div>
    );
}

function SquadForm({ formData, setFormData, serviceClasses }) {
    const wipIdeal = calculateWipIdeal(formData);

    return (
        <>
            <div className="form-group">
                <label>Nome *</label>
                <input
                    type="text"
                    value={formData.name || ''}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="Ex: Squad Alpha"
                />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Throughput (issues/sem)</label>
                    <input
                        type="number"
                        value={formData.throughput || ''}
                        onChange={e => setFormData({...formData, throughput: e.target.value})}
                        min="0.1" step="0.5"
                    />
                </div>
                <div className="form-group">
                    <label>Lead Time (dias)</label>
                    <input
                        type="number"
                        value={formData.leadTime || ''}
                        onChange={e => setFormData({...formData, leadTime: e.target.value})}
                        min="1"
                    />
                </div>
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>WIP Atual</label>
                    <input
                        type="number"
                        value={formData.wipAtual || ''}
                        onChange={e => setFormData({...formData, wipAtual: e.target.value})}
                        min="0"
                    />
                </div>
                <div className="form-group">
                    <label>WIP Ideal (Lei de Little)</label>
                    <div className="calculated-value">
                        <span className="calculated-number">{wipIdeal}</span>
                        <span className="calculated-formula">= {formData.throughput || 0} × ({formData.leadTime || 0} ÷ 7)</span>
                    </div>
                </div>
            </div>
            <div className="form-group">
                <label>CoV por Classe de Serviço</label>
                <div className="cov-grid">
                    {Object.entries(serviceClasses).map(([key, cls]) => (
                        <div key={key} className="cov-item">
                            <span>{cls.icon} {cls.name}</span>
                            <input
                                type="number"
                                value={formData.classMetrics?.[key]?.cov || cls.cov}
                                onChange={e => setFormData({
                                    ...formData,
                                    classMetrics: {
                                        ...formData.classMetrics,
                                        [key]: { cov: parseFloat(e.target.value) || cls.cov }
                                    }
                                })}
                                min="0" max="1" step="0.05"
                            />
                        </div>
                    ))}
                </div>
            </div>
            <div className="form-group">
                <label>Cor</label>
                <div className="color-picker">
                    {SQUAD_COLORS.map(color => (
                        <div
                            key={color}
                            className={`color-option ${formData.color === color ? 'selected' : ''}`}
                            style={{background: color}}
                            onClick={() => setFormData({...formData, color})}
                        />
                    ))}
                </div>
            </div>
        </>
    );
}

function ItemForm({ formData, setFormData, availableTypes, squads, items, serviceClasses, linkTypes, addAllocation, updateAllocation, removeAllocation, addDependency, updateDependency, removeDependency }) {
    return (
        <>
            <div className="form-group">
                <label>Nome *</label>
                <input
                    type="text"
                    value={formData.name || ''}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="Ex: Implementar Login SSO"
                />
            </div>
            <div className="form-row">
                <div className="form-group">
                    <label>Tipo</label>
                    <select
                        value={formData.type || availableTypes[0]}
                        onChange={e => setFormData({...formData, type: e.target.value})}
                    >
                        {availableTypes.map(type => (
                            <option key={type} value={type}>{type}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Classe de Serviço</label>
                    <select
                        value={formData.serviceClass || 'standard'}
                        onChange={e => setFormData({...formData, serviceClass: e.target.value})}
                    >
                        {Object.entries(serviceClasses).map(([key, cls]) => (
                            <option key={key} value={key}>{cls.icon} {cls.name}</option>
                        ))}
                    </select>
                </div>
                <div className="form-group">
                    <label>Prioridade</label>
                    <input
                        type="number"
                        value={formData.priority || ''}
                        onChange={e => setFormData({...formData, priority: e.target.value})}
                        min="1"
                    />
                </div>
            </div>

            {/* Quantidade de Issues */}
            <div className="form-section">
                <div className="section-header">
                    <label>Quantidade de Issues</label>
                </div>
                <div className="issue-count-options">
                    <label className="radio-option">
                        <input
                            type="radio"
                            checked={!formData.useRealChildren}
                            onChange={() => setFormData({...formData, useRealChildren: false})}
                        />
                        <span>Estimativa manual</span>
                    </label>
                    <label className="radio-option">
                        <input
                            type="radio"
                            checked={formData.useRealChildren}
                            onChange={() => setFormData({...formData, useRealChildren: true})}
                            disabled={!formData.realChildCount}
                        />
                        <span>Issues reais do Jira ({formData.realChildCount || 0})</span>
                    </label>
                </div>
                {!formData.useRealChildren && (
                    <input
                        type="number"
                        value={formData.estimatedIssues || ''}
                        onChange={e => setFormData({...formData, estimatedIssues: e.target.value})}
                        placeholder="Quantidade estimada de issues"
                        min="1"
                        className="issue-count-input"
                    />
                )}
                {formData.useRealChildren && formData.childStats && (
                    <div className="child-stats">
                        <span className="stat-todo">📋 {formData.childStats.todo} To Do</span>
                        <span className="stat-progress">🔄 {formData.childStats.inProgress} Em Progresso</span>
                        <span className="stat-done">✅ {formData.childStats.done} Concluídas</span>
                    </div>
                )}
            </div>

            {/* Alocações */}
            <div className="form-section">
                <div className="section-header">
                    <label>Alocação de Squads</label>
                    <button className="btn-small btn-primary" onClick={addAllocation}>+ Squad</button>
                </div>
                {(formData.squadAllocations || []).map((alloc, idx) => (
                    <div key={idx} className="allocation-row">
                        <select
                            value={alloc.squadId || ''}
                            onChange={e => updateAllocation(idx, 'squadId', e.target.value)}
                        >
                            {squads.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                        <input
                            type="number"
                            value={alloc.percentage || 100}
                            onChange={e => updateAllocation(idx, 'percentage', e.target.value)}
                            placeholder="%"
                            min="1" max="100"
                            className="percentage-input"
                        />
                        <span className="percentage-label">%</span>
                        <input
                            type="date"
                            value={alloc.startDate || ''}
                            onChange={e => updateAllocation(idx, 'startDate', e.target.value || null)}
                        />
                        {(formData.squadAllocations || []).length > 1 && (
                            <button className="btn-icon danger" onClick={() => removeAllocation(idx)}>✕</button>
                        )}
                    </div>
                ))}
            </div>

            {/* Dependências */}
            <div className="form-section">
                <div className="section-header">
                    <label>Dependências</label>
                    <button className="btn-small btn-primary" onClick={addDependency}>+ Dependência</button>
                </div>
                {(formData.dependencies || []).map((dep, idx) => (
                    <div key={idx} className="dependency-row">
                        <select
                            value={dep.type || 'blockedBy'}
                            onChange={e => updateDependency(idx, 'type', e.target.value)}
                        >
                            <option value="blockedBy">🚫 Bloqueado por</option>
                            <option value="blocks">⏸️ Bloqueia</option>
                            <option value="relatedTo">🔗 Relacionado a</option>
                        </select>
                        <select
                            value={dep.targetKey || dep.targetId || ''}
                            onChange={e => updateDependency(idx, 'targetKey', e.target.value)}
                        >
                            <option value="">Selecione...</option>
                            {items.filter(i => i.id !== formData.id).map(i => (
                                <option key={i.id} value={i.jiraKey || i.id}>
                                    {i.jiraKey ? `${i.jiraKey} - ` : ''}{i.name}
                                </option>
                            ))}
                        </select>
                        <button className="btn-icon danger" onClick={() => removeDependency(idx)}>✕</button>
                    </div>
                ))}
                {formData.jiraKey && (
                    <p className="form-hint">💡 Dependências importadas do Jira aparecem automaticamente</p>
                )}
            </div>
        </>
    );
}

function ConfigForm({ config, setConfig, issueTypes, linkTypes, showToast }) {
    const [localHierarchy, setLocalHierarchy] = useState(config.hierarchyConfig.levels || []);

    const toggleHierarchyLevel = (typeName) => {
        setLocalHierarchy(prev => {
            if (prev.includes(typeName)) {
                return prev.filter(t => t !== typeName);
            }
            return [...prev, typeName];
        });
    };

    const saveHierarchy = () => {
        setConfig(prev => ({
            ...prev,
            hierarchyConfig: {
                enabled: localHierarchy.length > 0,
                levels: localHierarchy
            }
        }));
        showToast('✅ Hierarquia salva', 'success');
    };

    return (
        <>
            {/* Hierarquia de Tipos */}
            <div className="config-section">
                <h3>📊 Hierarquia de Tipos de Issue</h3>
                <p className="config-description">Selecione os tipos de issue que deseja usar no roadmap:</p>
                <div className="type-selector">
                    {issueTypes.map(type => (
                        <label key={type.id} className={`type-option ${localHierarchy.includes(type.name) ? 'selected' : ''}`}>
                            <input
                                type="checkbox"
                                checked={localHierarchy.includes(type.name)}
                                onChange={() => toggleHierarchyLevel(type.name)}
                            />
                            {type.iconUrl && <img src={type.iconUrl} alt="" className="type-icon" />}
                            <span>{type.name}</span>
                            {type.hierarchyLevel !== undefined && (
                                <span className="hierarchy-level">Nível {type.hierarchyLevel}</span>
                            )}
                        </label>
                    ))}
                </div>
                <button className="btn btn-primary btn-sm" onClick={saveHierarchy}>Salvar Hierarquia</button>
            </div>

            {/* Classes de Serviço */}
            <div className="config-section">
                <h3>🏷️ Classes de Serviço</h3>
                <div className="service-class-list">
                    {Object.entries(config.serviceClasses).map(([key, cls]) => (
                        <div key={key} className="service-class-item">
                            <span className="service-class-icon" style={{background: cls.color}}>{cls.icon}</span>
                            <input
                                type="text"
                                value={cls.name}
                                onChange={e => setConfig(prev => ({
                                    ...prev,
                                    serviceClasses: {
                                        ...prev.serviceClasses,
                                        [key]: { ...cls, name: e.target.value }
                                    }
                                }))}
                            />
                            <input
                                type="number"
                                value={cls.cov}
                                onChange={e => setConfig(prev => ({
                                    ...prev,
                                    serviceClasses: {
                                        ...prev.serviceClasses,
                                        [key]: { ...cls, cov: parseFloat(e.target.value) }
                                    }
                                }))}
                                min="0" max="1" step="0.05"
                                className="cov-input"
                            />
                            <span className="cov-label">CoV</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tipos de Link */}
            <div className="config-section">
                <h3>🔗 Mapeamento de Dependências</h3>
                <p className="config-description">Configure como os links do Jira são interpretados:</p>
                <div className="link-type-list">
                    {linkTypes.map(lt => (
                        <div key={lt.id} className="link-type-item">
                            <span className="link-type-name">{lt.name}</span>
                            <span className="link-type-arrows">
                <span className="link-inward">← {lt.inward}</span>
                <span className="link-outward">→ {lt.outward}</span>
              </span>
                            <select
                                value={config.linkTypeMapping[lt.name]?.inwardType || 'ignore'}
                                onChange={e => setConfig(prev => ({
                                    ...prev,
                                    linkTypeMapping: {
                                        ...prev.linkTypeMapping,
                                        [lt.name]: {
                                            ...prev.linkTypeMapping[lt.name],
                                            inwardType: e.target.value,
                                            outwardType: e.target.value === 'blockedBy' ? 'blocks' :
                                                e.target.value === 'blocks' ? 'blockedBy' : 'relatedTo'
                                        }
                                    }
                                }))}
                            >
                                <option value="ignore">Ignorar</option>
                                <option value="blockedBy">Bloqueado por</option>
                                <option value="blocks">Bloqueia</option>
                                <option value="relatedTo">Relacionado</option>
                            </select>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}

function ImportForm({ issues, onConfirm, onCancel }) {
    const [selected, setSelected] = useState(new Set(issues.map(i => i.id)));

    const toggleAll = (checked) => {
        if (checked) {
            setSelected(new Set(issues.map(i => i.id)));
        } else {
            setSelected(new Set());
        }
    };

    const toggleOne = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    return (
        <>
            <div className="import-header">
                <label>
                    <input
                        type="checkbox"
                        checked={selected.size === issues.length}
                        onChange={e => toggleAll(e.target.checked)}
                    />
                    Selecionar todos ({selected.size}/{issues.length})
                </label>
            </div>
            <div className="import-list">
                {issues.map(issue => (
                    <label key={issue.id} className={`import-item ${selected.has(issue.id) ? 'selected' : ''}`}>
                        <input
                            type="checkbox"
                            checked={selected.has(issue.id)}
                            onChange={() => toggleOne(issue.id)}
                        />
                        <div className="import-item-content">
                            <div className="import-item-header">
                                {issue.type.iconUrl && <img src={issue.type.iconUrl} alt="" className="type-icon" />}
                                <span className="import-key">{issue.key}</span>
                                <span className={`status-badge status-${issue.status.category}`}>{issue.status.name}</span>
                            </div>
                            <div className="import-item-summary">{issue.summary}</div>
                            {issue.links.length > 0 && (
                                <div className="import-item-links">🔗 {issue.links.length} links</div>
                            )}
                        </div>
                    </label>
                ))}
            </div>
            <div className="modal-footer">
                <button className="btn" onClick={onCancel}>Cancelar</button>
                <button
                    className="btn btn-success"
                    onClick={() => onConfirm(issues.filter(i => selected.has(i.id)))}
                    disabled={selected.size === 0}
                >
                    ✓ Importar ({selected.size})
                </button>
            </div>
        </>
    );
}

function QueueView({ squads, items, selectedItems, serviceClasses, onEditItem }) {
    return (
        <div className="queue-view">
            <div className="queue-container">
                <div className="queue-main">
                    {squads.map(squad => {
                        const squadItems = selectedItems
                            .filter(i => (i.squadAllocations || []).some(a => a.squadId === squad.id))
                            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

                        const wipIdeal = calculateWipIdeal(squad);
                        const wipStatus = getWipStatus(squad);

                        return (
                            <div key={squad.id} className="queue-column">
                                <div className="queue-column-header">
                                    <div className="queue-column-title">
                                        <span className="squad-dot" style={{background: squad.color}} />
                                        {squad.name}
                                    </div>
                                    <div className="queue-column-metrics">
                                        <div className="queue-metric">
                                            <div className="queue-metric-label">TP</div>
                                            <div className="queue-metric-value">{squad.throughput}/sem</div>
                                        </div>
                                        <div className="queue-metric">
                                            <div className="queue-metric-label">WIP</div>
                                            <div className={`queue-metric-value ${wipStatus}`}>{squad.wipAtual}/{wipIdeal}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="queue-column-body">
                                    {squadItems.length === 0 ? (
                                        <div className="queue-empty">
                                            <div className="queue-empty-icon">📭</div>
                                            <div>Sem itens</div>
                                        </div>
                                    ) : (
                                        squadItems.map((item, idx) => {
                                            const alloc = (item.squadAllocations || []).find(a => a.squadId === squad.id);
                                            const serviceClass = serviceClasses[item.serviceClass] || DEFAULT_SERVICE_CLASSES.standard;
                                            const deps = (item.dependencies || []).filter(d => d.type === 'blockedBy');

                                            return (
                                                <div key={item.id} className="queue-item" onClick={() => onEditItem(item)}>
                                                    <div className="queue-item-position">{idx + 1}</div>
                                                    <div className="queue-item-header">
                                                        <div className="queue-item-info">
                                                            <div className="queue-item-title">
                                                                {item.jiraKey && <span className="queue-item-key">{item.jiraKey}</span>}
                                                                {item.name}
                                                            </div>
                                                            <div className="queue-item-meta">
                                <span className={`queue-item-badge`} style={{background: serviceClass.color + '20', color: serviceClass.color}}>
                                  {serviceClass.icon} {serviceClass.name}
                                </span>
                                                                <span>{getTotalIssues(item)} issues</span>
                                                                <span>{alloc?.percentage || 100}%</span>
                                                            </div>
                                                            {deps.length > 0 && (
                                                                <div className="queue-item-deps">
                                                                    🔗 Bloqueado por {deps.length} item(s)
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function TimelineView({ squads, items, selectedItems, config, timelineOffset, setTimelineOffset, timelineRef }) {
    const weeks = generateWeeks(16, timelineOffset);

    const scrollLeft = () => setTimelineOffset(prev => prev - 4);
    const scrollRight = () => setTimelineOffset(prev => prev + 4);
    const goToToday = () => setTimelineOffset(0);

    return (
        <div className="timeline-view">
            <div className="card full-width">
                <div className="timeline-header">
                    <h2>📅 Timeline</h2>
                    <div className="timeline-controls">
                        <button className="btn btn-sm" onClick={scrollLeft}>◀ Anterior</button>
                        <button className="btn btn-sm btn-primary" onClick={goToToday}>Hoje</button>
                        <button className="btn btn-sm" onClick={scrollRight}>Próximo ▶</button>
                    </div>
                </div>
                <div className="timeline-container" ref={timelineRef}>
                    <div className="timeline-header-row">
                        <div className="timeline-label-cell">Squad / Item</div>
                        {weeks.map(w => (
                            <div key={w.index} className={`timeline-week-cell ${w.isCurrentWeek ? 'current-week' : ''}`}>
                                <div className="week-date">{w.dateLabel}</div>
                            </div>
                        ))}
                    </div>

                    {squads.map(squad => {
                        const squadItems = selectedItems
                            .filter(i => (i.squadAllocations || []).some(a => a.squadId === squad.id))
                            .sort((a, b) => (a.priority || 999) - (b.priority || 999));

                        // Preparar itens com índices de semana
                        const itemsWithDates = squadItems.map(item => {
                            const alloc = (item.squadAllocations || []).find(a => a.squadId === squad.id);
                            const totalIssues = getTotalIssues(item) * (alloc?.percentage || 100) / 100;
                            const startWeekFloat = alloc?.startDate ? dateToWeeks(alloc.startDate) : 0;
                            const startWeekIndex = Math.floor(startWeekFloat);
                            const duration = Math.max(1, Math.ceil(totalIssues / squad.throughput));

                            return {
                                ...item,
                                alloc,
                                totalIssues,
                                startWeekIndex,
                                endWeekIndex: startWeekIndex + duration - 1,
                                duration
                            };
                        });

                        // Calcular lanes para evitar sobreposição
                        const { items: itemsWithLanes, totalLanes } = calculateLanes(itemsWithDates, timelineOffset);

                        return (
                            <div key={squad.id} className="timeline-squad-section">
                                <div className="timeline-squad-header">
                                    <span className="squad-dot" style={{background: squad.color}} />
                                    {squad.name}
                                    <span className="squad-stats">
                                        ({squadItems.length} itens, TP: {squad.throughput}/sem)
                                    </span>
                                </div>
                                <div className="timeline-squad-body" style={{minHeight: `${Math.max(1, totalLanes) * 36 + 8}px`}}>
                                    {itemsWithLanes.map(item => {
                                        const startWeek = item.startWeekIndex - timelineOffset;
                                        const progress = item.childStats
                                            ? Math.round((item.childStats.done / (item.childStats.todo + item.childStats.inProgress + item.childStats.done)) * 100) || 0
                                            : 0;

                                        // Verifica se está visível na janela atual
                                        if (startWeek + item.duration < 0 || startWeek >= weeks.length) {
                                            return null;
                                        }

                                        const visibleStart = Math.max(0, startWeek);
                                        const visibleEnd = Math.min(weeks.length - 1, startWeek + item.duration - 1);
                                        const visibleWidth = visibleEnd - visibleStart + 1;

                                        return (
                                            <div
                                                key={item.id}
                                                className="timeline-bar-positioned"
                                                style={{
                                                    left: `calc(150px + ${visibleStart} * (100% - 150px) / ${weeks.length})`,
                                                    width: `calc(${visibleWidth} * (100% - 150px) / ${weeks.length} - 4px)`,
                                                    top: `${item.lane * 36 + 4}px`,
                                                    backgroundColor: squad.color
                                                }}
                                                title={`${item.name}: ${formatDate(weeksToDate(item.startWeekIndex))} - ${formatDate(weeksToDate(item.startWeekIndex + item.duration))}`}
                                            >
                                                {progress > 0 && (
                                                    <div className="timeline-bar-progress" style={{width: `${progress}%`}} />
                                                )}
                                                <span className="timeline-bar-label">
                                                    {item.jiraKey && <span className="bar-key">{item.jiraKey}</span>}
                                                    {item.name.length > 20 ? item.name.substring(0, 20) + '...' : item.name}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Histograma de carga */}
                                <div className="timeline-load-histogram">
                                    {weeks.map((w, wIdx) => {
                                        // Calcula carga nesta semana
                                        let weekLoad = 0;
                                        itemsWithLanes.forEach(item => {
                                            const startWeek = item.startWeekIndex - timelineOffset;
                                            if (wIdx >= startWeek && wIdx < startWeek + item.duration) {
                                                weekLoad += item.totalIssues / item.duration;
                                            }
                                        });

                                        const utilization = Math.round((weekLoad / squad.throughput) * 100);
                                        const statusClass = utilization < 50 ? 'low' : utilization <= 85 ? 'ok' : utilization <= 100 ? 'warning' : 'danger';

                                        return (
                                            <div
                                                key={w.index}
                                                className={`load-cell ${w.isCurrentWeek ? 'current-week' : ''}`}
                                                title={`${weekLoad.toFixed(1)} issues (${utilization}% capacidade)`}
                                            >
                                                {weekLoad > 0 && (
                                                    <div
                                                        className={`load-bar ${statusClass}`}
                                                        style={{height: `${Math.min(utilization, 150) / 1.5}%`}}
                                                    >
                                                        {utilization >= 50 && <span>{utilization}%</span>}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

function HeatmapView({ squads, items, selectedItems, timelineOffset, setTimelineOffset }) {
    const weeks = generateWeeks(16, timelineOffset);

    const scrollLeft = () => setTimelineOffset(prev => prev - 4);
    const scrollRight = () => setTimelineOffset(prev => prev + 4);
    const goToToday = () => setTimelineOffset(0);

    // Calcula carga por squad/semana
    const loadMap = useMemo(() => {
        const map = new Map();

        selectedItems.forEach(item => {
            (item.squadAllocations || []).forEach(alloc => {
                const squad = squads.find(s => s.id === alloc.squadId);
                if (!squad) return;

                const totalIssues = getTotalIssues(item) * (alloc.percentage || 100) / 100;
                const startWeekFloat = alloc.startDate ? dateToWeeks(alloc.startDate) : 0;
                const startWeek = Math.floor(startWeekFloat);
                const duration = Math.max(1, Math.ceil(totalIssues / squad.throughput));
                const issuesPerWeek = totalIssues / duration;

                for (let w = startWeek; w < startWeek + duration; w++) {
                    const key = `${squad.id}-${w}`;
                    map.set(key, (map.get(key) || 0) + issuesPerWeek);
                }
            });
        });

        return map;
    }, [selectedItems, squads]);

    const getHeatColor = (load, capacity) => {
        const ratio = load / capacity;
        if (ratio < 0.5) return '#dbeafe';
        if (ratio < 0.85) return '#dcfce7';
        if (ratio <= 1) return '#fef9c3';
        return '#fee2e2';
    };

    return (
        <div className="heatmap-view">
            <div className="card full-width">
                <div className="timeline-header">
                    <h2>🔥 Heatmap de Carga</h2>
                    <div className="timeline-controls">
                        <button className="btn btn-sm" onClick={scrollLeft}>◀ Anterior</button>
                        <button className="btn btn-sm btn-primary" onClick={goToToday}>Hoje</button>
                        <button className="btn btn-sm" onClick={scrollRight}>Próximo ▶</button>
                    </div>
                </div>
                <div className="heatmap-container">
                    <div className="heatmap-header-row">
                        <div className="heatmap-label-cell">Squad</div>
                        {weeks.map(w => (
                            <div key={w.index} className={`heatmap-week-cell ${w.isCurrentWeek ? 'current-week' : ''}`}>
                                {w.dateLabel}
                            </div>
                        ))}
                        <div className="heatmap-week-cell">Média</div>
                    </div>

                    {squads.map(squad => {
                        const weekLoads = weeks.map(w => {
                            const load = loadMap.get(`${squad.id}-${w.index + timelineOffset}`) || 0;
                            return { load, ratio: load / squad.throughput };
                        });

                        const avgRatio = weekLoads.reduce((sum, w) => sum + w.ratio, 0) / weeks.length;

                        return (
                            <div key={squad.id} className="heatmap-row">
                                <div className="heatmap-label-cell">
                                    <span className="squad-dot" style={{background: squad.color}} />
                                    {squad.name}
                                </div>
                                {weekLoads.map((w, idx) => (
                                    <div
                                        key={idx}
                                        className={`heatmap-cell ${weeks[idx].isCurrentWeek ? 'current-week' : ''}`}
                                        style={{background: w.load > 0 ? getHeatColor(w.load, squad.throughput) : 'transparent'}}
                                        title={`${w.load.toFixed(1)} / ${squad.throughput} (${Math.round(w.ratio * 100)}%)`}
                                    >
                                        {w.load > 0 && <span>{Math.round(w.ratio * 100)}%</span>}
                                    </div>
                                ))}
                                <div
                                    className="heatmap-cell heatmap-avg"
                                    style={{background: getHeatColor(avgRatio * squad.throughput, squad.throughput)}}
                                >
                                    {Math.round(avgRatio * 100)}%
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="heatmap-legend">
                    <span><span className="legend-dot" style={{background: '#dbeafe'}} /> &lt;50%</span>
                    <span><span className="legend-dot" style={{background: '#dcfce7'}} /> 50-85%</span>
                    <span><span className="legend-dot" style={{background: '#fef9c3'}} /> 85-100%</span>
                    <span><span className="legend-dot" style={{background: '#fee2e2'}} /> &gt;100%</span>
                </div>
            </div>
        </div>
    );
}

function ResultsView({ results, squads, serviceClasses, onRunSimulation }) {
    if (!results) {
        return (
            <div className="results-view">
                <div className="card full-width">
                    <div className="empty-state">
                        <div className="empty-icon">📊</div>
                        <p>Nenhum resultado</p>
                        <button className="btn btn-primary" onClick={onRunSimulation}>🚀 Executar Simulação</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="results-view">
            <div className="card full-width results-summary">
                <h2>📊 Resultados Monte Carlo</h2>
                <p className="results-subtitle">{results.numSims.toLocaleString()} simulações • {results.projections.length} projeções</p>

                <div className="results-grid">
                    <div className="result-card">
                        <div className="result-label">Original</div>
                        <div className="result-value">{results.originalTotal}</div>
                        <div className="result-sub">issues</div>
                    </div>
                    <div className="result-card highlight">
                        <div className="result-label">P50</div>
                        <div className="result-value">{results.p50.toFixed(1)}s</div>
                        <div className="result-sub">{formatDate(weeksToDate(results.p50))}</div>
                    </div>
                    <div className="result-card highlight">
                        <div className="result-label">P85</div>
                        <div className="result-value">{results.p85.toFixed(1)}s</div>
                        <div className="result-sub">{formatDate(weeksToDate(results.p85))}</div>
                    </div>
                    <div className="result-card">
                        <div className="result-label">P95</div>
                        <div className="result-value">{results.p95.toFixed(1)}s</div>
                        <div className="result-sub">{formatDate(weeksToDate(results.p95))}</div>
                    </div>
                </div>
            </div>

            <div className="card full-width">
                <h3>📅 Linha do Tempo</h3>
                <div className="timeline-visual">
                    <div className="timeline-header-labels">
                        <span>Hoje</span>
                        <span>{results.p95.toFixed(1)} semanas</span>
                    </div>
                    <div className="timeline-bar-container">
                        <div className="timeline-bar timeline-p50" style={{width: `${(results.p50 / results.p95) * 100}%`}}>P50</div>
                        <div className="timeline-bar timeline-p85" style={{left: `${(results.p50 / results.p95) * 100}%`, width: `${((results.p85 - results.p50) / results.p95) * 100}%`}}>P85</div>
                        <div className="timeline-bar timeline-p95" style={{left: `${(results.p85 / results.p95) * 100}%`, width: `${((results.p95 - results.p85) / results.p95) * 100}%`}}>P95</div>
                    </div>
                    <div className="percentile-markers">
                        <div className="percentile-marker"><span className="marker-dot dot-p50" />P50: {results.p50.toFixed(1)}s ({formatDate(weeksToDate(results.p50))})</div>
                        <div className="percentile-marker"><span className="marker-dot dot-p85" />P85: {results.p85.toFixed(1)}s ({formatDate(weeksToDate(results.p85))})</div>
                        <div className="percentile-marker"><span className="marker-dot dot-p95" />P95: {results.p95.toFixed(1)}s ({formatDate(weeksToDate(results.p95))})</div>
                    </div>
                </div>
            </div>

            <div className="card full-width">
                <h3>📋 Projeções por Item</h3>
                <div className="projection-table-container">
                    <table className="projection-table">
                        <thead>
                        <tr>
                            <th>Item</th>
                            <th>Squad</th>
                            <th>Classe</th>
                            <th>CoV</th>
                            <th>Issues</th>
                            <th>P50</th>
                            <th>P85</th>
                            <th>P95</th>
                        </tr>
                        </thead>
                        <tbody>
                        {results.projections.map((p, idx) => {
                            const serviceClass = serviceClasses[p.item.serviceClass] || DEFAULT_SERVICE_CLASSES.standard;
                            return (
                                <tr key={idx}>
                                    <td>
                                        {p.item.jiraKey && <span className="jira-key-small">{p.item.jiraKey}</span>}
                                        <strong>{p.item.name}</strong>
                                    </td>
                                    <td>
                      <span className="squad-indicator">
                        <span className="color-dot-small" style={{background: p.squad.color}} />
                          {p.squad.name}
                      </span>
                                    </td>
                                    <td>
                      <span className={`badge`} style={{background: serviceClass.color + '20', color: serviceClass.color}}>
                        {serviceClass.icon} {serviceClass.name}
                      </span>
                                    </td>
                                    <td>{(p.cov * 100).toFixed(0)}%</td>
                                    <td>{p.issues.toFixed(0)}</td>
                                    <td>{formatDate(weeksToDate(p.p50))}</td>
                                    <td>{formatDate(weeksToDate(p.p85))}</td>
                                    <td>{formatDate(weeksToDate(p.p95))}</td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="card full-width">
                <h3>📊 Distribuição</h3>
                <div className="histogram">
                    {(() => {
                        const bins = new Array(30).fill(0);
                        const range = results.p95 - results.p5;
                        if (range <= 0) return null;
                        const binSize = range / 30;
                        results.allResults.forEach(r => {
                            if (r >= results.p5 && r <= results.p95) {
                                bins[Math.min(Math.floor((r - results.p5) / binSize), 29)]++;
                            }
                        });
                        const maxBin = Math.max(...bins);
                        return bins.map((c, i) => (
                            <div key={i} className="histogram-bar" style={{height: `${maxBin > 0 ? (c / maxBin) * 100 : 0}%`}} />
                        ));
                    })()}
                </div>
                <div className="histogram-labels">
                    <span>P5: {results.p5.toFixed(1)}s</span>
                    <span>P50: {results.p50.toFixed(1)}s</span>
                    <span>P95: {results.p95.toFixed(1)}s</span>
                </div>
            </div>
        </div>
    );
}

function MetricsView({ squads, metricsData, jiraConnected, onLoadMetrics, calculateWipIdeal }) {
    // Gerar dados de exemplo para demonstração
    const generateSampleData = useCallback(() => {
        const weeks = [];
        const today = new Date();

        for (let i = 11; i >= 0; i--) {
            const weekDate = new Date(today);
            weekDate.setDate(weekDate.getDate() - (i * 7));
            weeks.push({
                week: `S${12 - i}`,
                weekStart: weekDate.toISOString().split('T')[0]
            });
        }

        return squads.map(squad => {
            const wipIdeal = calculateWipIdeal(squad);
            return {
                squad,
                wipIdeal,
                history: weeks.map((w, idx) => {
                    const variation = Math.sin(idx * 0.5) * (wipIdeal * 0.3);
                    const wipAtual = Math.max(1, Math.round(wipIdeal + variation + (Math.random() - 0.5) * 3));
                    return {
                        ...w,
                        wipAtual,
                        wipIdeal,
                        throughput: Math.max(1, Math.round(squad.throughput + (Math.random() - 0.5) * 2))
                    };
                })
            };
        });
    }, [squads, calculateWipIdeal]);

    const squadData = useMemo(() => {
        if (metricsData.loaded && metricsData.wipHistory.length > 0) {
            return squads.map(squad => ({
                squad,
                wipIdeal: calculateWipIdeal(squad),
                history: metricsData.wipHistory
            }));
        }
        return generateSampleData();
    }, [squads, metricsData, calculateWipIdeal, generateSampleData]);

    const maxWip = useMemo(() => {
        let max = 0;
        squadData.forEach(sd => {
            sd.history.forEach(h => {
                max = Math.max(max, h.wipAtual, h.wipIdeal);
            });
        });
        return Math.ceil((max || 10) * 1.2); // 20% margin
    }, [squadData]);

    // SVG Line Chart Component
    const LineChart = ({ data, squad, wipIdeal, maxValue }) => {
        const width = 600;
        const height = 200;
        const padding = { top: 20, right: 30, bottom: 40, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const xStep = chartWidth / (data.length - 1);

        // Generate path for WIP Atual line
        const wipPath = data.map((d, i) => {
            const x = padding.left + i * xStep;
            const y = padding.top + chartHeight - (d.wipAtual / maxValue) * chartHeight;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
        }).join(' ');

        // Generate path for ideal line
        const idealY = padding.top + chartHeight - (wipIdeal / maxValue) * chartHeight;

        // Area under WIP line
        const areaPath = wipPath +
            ` L ${padding.left + (data.length - 1) * xStep} ${padding.top + chartHeight}` +
            ` L ${padding.left} ${padding.top + chartHeight} Z`;

        return (
            <svg viewBox={`0 0 ${width} ${height}`} className="line-chart-svg">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
                    <g key={i}>
                        <line
                            x1={padding.left}
                            y1={padding.top + chartHeight * (1 - pct)}
                            x2={width - padding.right}
                            y2={padding.top + chartHeight * (1 - pct)}
                            stroke="#e2e8f0"
                            strokeWidth="1"
                        />
                        <text
                            x={padding.left - 8}
                            y={padding.top + chartHeight * (1 - pct) + 4}
                            textAnchor="end"
                            fontSize="11"
                            fill="#64748b"
                        >
                            {Math.round(maxValue * pct)}
                        </text>
                    </g>
                ))}

                {/* Ideal line (dashed) */}
                <line
                    x1={padding.left}
                    y1={idealY}
                    x2={width - padding.right}
                    y2={idealY}
                    stroke="#1e3a5f"
                    strokeWidth="2"
                    strokeDasharray="8 4"
                />
                <text
                    x={width - padding.right + 5}
                    y={idealY + 4}
                    fontSize="10"
                    fill="#1e3a5f"
                    fontWeight="600"
                >
                    Ideal
                </text>

                {/* Area fill */}
                <path
                    d={areaPath}
                    fill={squad.color}
                    fillOpacity="0.15"
                />

                {/* WIP line */}
                <path
                    d={wipPath}
                    fill="none"
                    stroke={squad.color}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Data points */}
                {data.map((d, i) => {
                    const x = padding.left + i * xStep;
                    const y = padding.top + chartHeight - (d.wipAtual / maxValue) * chartHeight;
                    const isAbove = d.wipAtual > wipIdeal;
                    const isNear = d.wipAtual >= wipIdeal * 0.8 && d.wipAtual <= wipIdeal;

                    return (
                        <g key={i}>
                            {/* Point */}
                            <circle
                                cx={x}
                                cy={y}
                                r="6"
                                fill={isAbove ? '#ef4444' : isNear ? '#f59e0b' : squad.color}
                                stroke="white"
                                strokeWidth="2"
                            />
                            {/* Value label */}
                            <text
                                x={x}
                                y={y - 12}
                                textAnchor="middle"
                                fontSize="10"
                                fontWeight="600"
                                fill={isAbove ? '#ef4444' : isNear ? '#f59e0b' : '#1e3a5f'}
                            >
                                {d.wipAtual}
                            </text>
                            {/* X-axis label */}
                            <text
                                x={x}
                                y={height - 10}
                                textAnchor="middle"
                                fontSize="10"
                                fill="#64748b"
                            >
                                {d.week}
                            </text>
                        </g>
                    );
                })}
            </svg>
        );
    };

    return (
        <div className="metrics-view">
            {/* Header */}
            <div className="metrics-page-header">
                <div className="metrics-title-section">
                    <h1>📉 Métricas de Fluxo</h1>
                    <p className="metrics-subtitle">
                        {metricsData.loaded
                            ? '✅ Dados carregados do Jira'
                            : '📊 Exibindo dados de exemplo'}
                    </p>
                </div>
                <button
                    className="btn btn-primary btn-lg"
                    onClick={onLoadMetrics}
                    disabled={!jiraConnected || metricsData.loading}
                >
                    {metricsData.loading ? '⏳ Carregando...' : '🔄 Sincronizar com Jira'}
                </button>
            </div>

            {/* KPI Cards */}
            {squads.length > 0 && (
                <div className="metrics-kpi-grid">
                    {squads.map(squad => {
                        const wipIdeal = calculateWipIdeal(squad);
                        const wipPercent = Math.round((squad.wipAtual / wipIdeal) * 100);
                        const wipStatus = wipPercent <= 80 ? 'ok' : wipPercent <= 100 ? 'warning' : 'danger';

                        return (
                            <div key={squad.id} className="metrics-kpi-card">
                                <div className="kpi-card-header">
                                    <div className="kpi-squad-info">
                                        <span className="kpi-squad-dot" style={{background: squad.color}} />
                                        <span className="kpi-squad-name">{squad.name}</span>
                                    </div>
                                    <div className={`kpi-status-badge ${wipStatus}`}>
                                        {wipStatus === 'ok' ? '✓ Saudável' : wipStatus === 'warning' ? '⚠ Atenção' : '🔥 Crítico'}
                                    </div>
                                </div>

                                <div className="kpi-metrics-row">
                                    <div className="kpi-metric">
                                        <span className="kpi-metric-value">{squad.throughput}</span>
                                        <span className="kpi-metric-label">Throughput/sem</span>
                                    </div>
                                    <div className="kpi-metric">
                                        <span className="kpi-metric-value">{squad.leadTime}d</span>
                                        <span className="kpi-metric-label">Lead Time</span>
                                    </div>
                                    <div className="kpi-metric highlight">
                                        <span className={`kpi-metric-value ${wipStatus}`}>{squad.wipAtual}</span>
                                        <span className="kpi-metric-label">WIP Atual</span>
                                    </div>
                                    <div className="kpi-metric">
                                        <span className="kpi-metric-value">{wipIdeal}</span>
                                        <span className="kpi-metric-label">WIP Ideal</span>
                                    </div>
                                </div>

                                <div className="kpi-progress-section">
                                    <div className="kpi-progress-header">
                                        <span>Utilização WIP</span>
                                        <span className={`kpi-progress-value ${wipStatus}`}>{wipPercent}%</span>
                                    </div>
                                    <div className="kpi-progress-track">
                                        <div
                                            className={`kpi-progress-fill ${wipStatus}`}
                                            style={{width: `${Math.min(wipPercent, 100)}%`}}
                                        />
                                        {wipPercent > 100 && (
                                            <div
                                                className="kpi-progress-overflow"
                                                style={{width: `${Math.min(wipPercent - 100, 50)}%`}}
                                            />
                                        )}
                                    </div>
                                    <div className="kpi-progress-labels">
                                        <span>0</span>
                                        <span>50%</span>
                                        <span>100% (ideal)</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* WIP History Line Chart */}
            {squadData.length > 0 && (
                <div className="metrics-chart-section">
                    <div className="chart-section-header">
                        <h2>📈 Histórico de WIP</h2>
                        <div className="chart-legend">
                            <span className="chart-legend-item">
                                <span className="legend-line-sample" />
                                WIP Atual
                            </span>
                            <span className="chart-legend-item">
                                <span className="legend-line-dashed" />
                                WIP Ideal
                            </span>
                            <span className="chart-legend-item">
                                <span className="legend-dot-sample ok" />
                                Saudável
                            </span>
                            <span className="chart-legend-item">
                                <span className="legend-dot-sample warning" />
                                Atenção
                            </span>
                            <span className="chart-legend-item">
                                <span className="legend-dot-sample danger" />
                                Crítico
                            </span>
                        </div>
                    </div>

                    {squadData.map(({ squad, wipIdeal, history }) => (
                        <div key={squad.id} className="chart-card">
                            <div className="chart-card-header">
                                <span className="squad-dot" style={{background: squad.color}} />
                                <span className="chart-card-title">{squad.name}</span>
                                <span className="chart-card-subtitle">
                                    WIP Ideal: {wipIdeal} (TP: {squad.throughput}/sem × LT: {(squad.leadTime / 7).toFixed(1)} sem)
                                </span>
                            </div>
                            <div className="chart-container">
                                <LineChart
                                    data={history}
                                    squad={squad}
                                    wipIdeal={wipIdeal}
                                    maxValue={maxWip}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Throughput Chart */}
            {squadData.length > 0 && (
                <div className="metrics-chart-section">
                    <div className="chart-section-header">
                        <h2>📊 Throughput Semanal</h2>
                    </div>

                    {squadData.map(({ squad, history }) => {
                        const maxTp = Math.max(...history.map(h => h.throughput || 0)) * 1.2;
                        const avgTp = history.reduce((sum, h) => sum + (h.throughput || 0), 0) / history.length;

                        return (
                            <div key={squad.id} className="chart-card">
                                <div className="chart-card-header">
                                    <span className="squad-dot" style={{background: squad.color}} />
                                    <span className="chart-card-title">{squad.name}</span>
                                    <span className="chart-card-subtitle">
                                        Média: {avgTp.toFixed(1)} issues/semana
                                    </span>
                                </div>
                                <div className="throughput-chart">
                                    {history.map((h, idx) => {
                                        const heightPct = ((h.throughput || 0) / maxTp) * 100;
                                        return (
                                            <div key={idx} className="tp-bar-col">
                                                <div className="tp-bar-value">{h.throughput || 0}</div>
                                                <div className="tp-bar-track">
                                                    <div
                                                        className="tp-bar-fill"
                                                        style={{height: `${heightPct}%`, background: squad.color}}
                                                    />
                                                </div>
                                                <div className="tp-bar-label">{h.week}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Empty State */}
            {squads.length === 0 && (
                <div className="metrics-empty-state">
                    <div className="empty-icon">📉</div>
                    <h3>Nenhum projeto carregado</h3>
                    <p>Importe itens do Jira para visualizar métricas de fluxo</p>
                </div>
            )}
        </div>
    );
}

export default App;