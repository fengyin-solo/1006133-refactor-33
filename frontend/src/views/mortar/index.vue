<template>
  <section class="page" data-module="mortar">
    <header class="page-head">
      <div>
        <h2>浆液拌制管理</h2>
        <p class="page-desc">
          批次能否投用统一按集中判据判定（当前版本 {{ policy.version }}，{{ policy.effectiveDate }} 生效）：
          稠度 {{ describeBand(policy.consistency) }}、水灰比 {{ describeBand(policy.waterCementRatio) }}；稠度为主判栏。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浆液批次</button>
        <button class="btn" type="button" @click="exportRows">导出浆液拌制台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待拌制/拌制中</span>
        <strong class="stat-value">{{ counts.waiting + counts.mixing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检验合格（可投用）</span>
        <strong class="stat-value">{{ counts.ready }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检验不合格</span>
        <strong class="stat-value">{{ counts.rejected }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已废弃</span>
        <strong class="stat-value">{{ counts.discarded }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span class="legend-item">待拌制：{{ counts.waiting }}</span>
      <span class="legend-item">拌制中：{{ counts.mixing }}</span>
      <span class="legend-item">检验合格：{{ counts.passed }}</span>
      <span class="legend-item">检验不合格：{{ counts.rejected }}</span>
      <span class="legend-item">已废弃：{{ counts.discarded }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>批次编号</span>
        <input v-model="keyword" placeholder="按批次编号/浆液类型检索" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>批次编号</th>
          <th>浆液类型</th>
          <th>水泥用量</th>
          <th>膨润土用量</th>
          <th>水灰比</th>
          <th>稠度</th>
          <th>拌制日期</th>
          <th>当前状态</th>
          <th>判定明细（统一引擎）</th>
          <th>判据版本</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filtered" :key="item.id">
          <td>{{ item.batchNo }}</td>
          <td>{{ item.slurryType }}</td>
          <td>{{ item.cementAmount }}</td>
          <td>{{ item.bentoniteAmount }}</td>
          <td>{{ item.waterCementRatio || '—' }}</td>
          <td>{{ item.consistency || '—' }}</td>
          <td>{{ item.mixedDate }}</td>
          <td>
            <span :class="['tag', statusTagClass(item.status)]">{{ item.status }}</span>
          </td>
          <td class="verdict-cell">
            <span :class="['tag', verdictTagClass(item.verdictLabel)]">{{ item.verdictLabel }}</span>
            <span class="cell-note">{{ item.reason }}</span>
            <span v-if="item.concluded && item.evaluation.policyVersion !== policy.version" class="cell-note warn">
              按判据 {{ item.evaluation.policyVersion }} 定论，结论保留；{{ item.recheckVerdict ? `现判据复判：${item.recheckVerdict}` : '' }}
            </span>
          </td>
          <td>{{ item.evaluation.policyVersion }}</td>
          <td class="row-actions">
            <button
              v-if="item.status === MORTAR_STATUS.waiting"
              class="link"
              type="button"
              @click="run(startMixing(item.id))"
            >
              开始拌制
            </button>
            <RouterLink v-if="item.status === MORTAR_STATUS.mixing" class="link" to="/mortar-inspection">
              去检验
            </RouterLink>
            <button
              v-if="item.status !== MORTAR_STATUS.discarded"
              class="link danger"
              type="button"
              :title="canDiscard(role) ? '' : '仅拌制站负责人可废弃'"
              @click="run(discardBatch(item.id, role))"
            >
              废弃批次
            </button>
            <span v-if="item.status === MORTAR_STATUS.discarded" class="cell-note">—</span>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="11" class="empty-state">暂无符合条件的浆液批次</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ views.length }} 条浆液批次；可投用 {{ counts.ready }} 批（与同步注浆待用清单同源同数）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记浆液批次</h3>
        <p class="cell-note">重复提交同一批次编号只入一条；任一校验不过或入库失败，数据一律不落。</p>
        <label v-for="field in formFields" :key="field.key" class="form-item">
          <span>{{ field.label }}</span>
          <input v-model="form[field.key]" :placeholder="field.placeholder" :type="field.type ?? 'text'" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">提交登记</button>
          <button class="btn ghost" type="button" @click="showForm = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  CURRENT_MORTAR_POLICY,
  describeBand,
} from '@/domain/mortar/policy'
import {
  discardBatch,
  MORTAR_STATUS,
  registerBatch,
  startMixing,
} from '@/domain/mortar/mortar-service'
import { downloadMortarLedger } from '@/domain/mortar/mortar-export'
import { listBatchViews, mortarCounts, type BatchView } from '@/domain/mortar/mortar-view'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const role = computed(() => store.role)
const policy = CURRENT_MORTAR_POLICY
const statuses = [MORTAR_STATUS.waiting, MORTAR_STATUS.mixing, MORTAR_STATUS.passed, MORTAR_STATUS.rejected, MORTAR_STATUS.discarded]

const views = ref<BatchView[]>([])
const keyword = ref('')
const statusFilter = ref('')
const message = ref('')
const messageOk = ref(false)

const showForm = ref(false)
const formError = ref('')
const formFields: { key: keyof typeof form; label: string; placeholder: string; type?: string }[] = [
  { key: 'batchNo', label: '批次编号', placeholder: '如 MORT-20261006-01' },
  { key: 'slurryType', label: '浆液类型', placeholder: '如 水泥砂浆' },
  { key: 'cementAmount', label: '水泥用量(kg)', placeholder: '如 180' },
  { key: 'bentoniteAmount', label: '膨润土用量(kg)', placeholder: '如 35' },
  { key: 'waterCementRatio', label: '水灰比', placeholder: '如 0.60' },
  { key: 'consistency', label: '稠度(mm)', placeholder: '如 95' },
  { key: 'mixedDate', label: '拌制日期', placeholder: 'YYYY-MM-DD', type: 'date' },
]
const form = reactive<Record<string, string>>({
  batchNo: '',
  slurryType: '',
  cementAmount: '',
  bentoniteAmount: '',
  waterCementRatio: '',
  consistency: '',
  mixedDate: '',
})

const filtered = computed<BatchView[]>(() => {
  const word = keyword.value.trim()
  return views.value.filter((item) => {
    const matchWord =
      word === '' || item.batchNo.includes(word) || item.slurryType.includes(word)
    const matchStatus = statusFilter.value === '' || item.status === statusFilter.value
    return matchWord && matchStatus
  })
})

const counts = computed(() => mortarCounts(views.value))

function canDiscard(r: string): boolean {
  return r === '拌制站负责人'
}

function statusTagClass(status: string): string {
  if (status === MORTAR_STATUS.passed) return 'tag-green'
  if (status === MORTAR_STATUS.rejected || status === MORTAR_STATUS.discarded) return 'tag-red'
  return 'tag-blue'
}

function verdictTagClass(label: string): string {
  if (label === '合格' || label === '预检合格') return 'tag-green'
  if (label === '已废弃') return 'tag-red'
  if (label === '数据不全' || label === '预检数据不全') return 'tag-gray'
  return 'tag-red'
}

function run(result: { ok: boolean; message: string }) {
  message.value = result.message
  messageOk.value = result.ok
  if (result.ok) {
    reload()
  }
}

function exportRows() {
  const readyCount = downloadMortarLedger()
  message.value = `台账已导出；其中可投用 ${readyCount} 批`
  messageOk.value = true
}

function openCreate() {
  formError.value = ''
  Object.keys(form).forEach((key) => {
    form[key] = ''
  })
  showForm.value = true
}

function submitCreate() {
  const result = registerBatch({
    batchNo: form.batchNo,
    slurryType: form.slurryType,
    cementAmount: form.cementAmount,
    bentoniteAmount: form.bentoniteAmount,
    waterCementRatio: form.waterCementRatio,
    consistency: form.consistency,
    mixedDate: form.mixedDate,
    role: role.value,
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showForm.value = false
  message.value = result.message
  messageOk.value = true
  reload()
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
}

function reload() {
  views.value = listBatchViews()
}

onMounted(reload)
</script>

<style scoped>
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.tag-green { background: #e7f6ec; color: #1a7f37; }
.tag-red { background: #fdecec; color: #b42318; }
.tag-blue { background: #e8f0fe; color: #1f6feb; }
.tag-gray { background: #eef2f7; color: #64748b; }
.verdict-cell { max-width: 280px; }
.cell-note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.cell-note.warn { color: #b54708; }
.link.danger { color: #b42318; }
.ok-text { color: #1a7f37; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 420px; max-height: 86vh; overflow: auto; }
.modal h3 { margin: 0 0 6px; }
.form-item { display: block; margin-bottom: 8px; }
.form-item span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-item input { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
</style>
