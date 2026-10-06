<template>
  <section class="page" data-module="mortar">
    <header class="page-head">
      <div>
        <h2>浆液拌制管理</h2>
        <p class="page-desc">合格性判据集中维护（现行 {{ criteria.version }}：{{ criteria.note }}），拌制页自检只作过程提示，检验入口复测后结论冻结。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浆液批次</button>
        <button class="btn" type="button" @click="goInspection()">前往检验复测</button>
        <button class="btn" type="button" @click="exportRows">导出浆液拌制台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待拌制批次</span>
        <strong class="stat-value">{{ counts.waiting }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">拌制中批次</span>
        <strong class="stat-value">{{ counts.mixing }}</strong>
      </article>
      <article class="stat-card stat-highlight">
        <span class="stat-label">可投用批次（待用清单）</span>
        <strong class="stat-value">{{ counts.usable }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">废弃批次</span>
        <strong class="stat-value">{{ counts.discarded }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">当前身份：{{ session.role }}<template v-if="!session.canDiscardMortar">（无权废弃）</template></span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>批次编号</span>
        <input v-model="batchNoFilter" placeholder="按批次编号检索" />
      </label>
      <label class="filter-item">
        <span>判定结论</span>
        <select v-model="verdictFilter">
          <option value="">全部</option>
          <option v-for="option in verdictOptions" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>自检提示（不结论）</th>
          <th>判定结论</th>
          <th>判定依据 / 判据</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ detailOf(row)[column] ?? '—' }}</td>
          <td>
            <span v-if="!verdictOf(row).frozen && selfSummary(row)" :class="selfPass(row) ? 'tag ok' : 'tag warn'">
              {{ selfSummary(row) }}
            </span>
            <span v-else class="muted-text">—</span>
          </td>
          <td><span :class="verdictClass(row)">{{ verdictOf(row).label }}</span></td>
          <td>
            <div>{{ verdictOf(row).basis }}</div>
            <div class="muted-text">判据 {{ verdictOf(row).criteriaVersion }}<template v-if="verdictOf(row).frozen"> · 已冻结</template></div>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待拌制'"
              class="link"
              type="button"
              @click="doStartMixing(row)"
            >
              开始拌制
            </button>
            <button
              v-if="String(row.status) === '拌制中'"
              class="link"
              type="button"
              @click="goInspection(row)"
            >
              送检验复测
            </button>
            <button
              v-if="String(row.status) !== '已废弃' && session.canDiscardMortar"
              class="link danger"
              type="button"
              @click="doDiscard(row)"
            >
              废弃批次
            </button>
            <button
              v-if="String(row.status) !== '已废弃' && !session.canDiscardMortar"
              class="link disabled-link"
              type="button"
              title="只有拌制站负责人能废弃批次"
              @click="denyDiscard"
            >
              废弃批次
            </button>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td :colspan="columns.length + 5" class="empty-state">暂无浆液拌制数据，可先登记浆液批次</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条浆液批次，待用清单与同步注浆页同源同数</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记浆液批次</h3>
        <label class="form-line">
          <span>批次编号 *</span>
          <input v-model="form.batchNo" placeholder="如 MORT-20261006-01" />
        </label>
        <label class="form-line">
          <span>浆液类型 *</span>
          <input v-model="form.mortarType" placeholder="如 同步注浆砂浆" />
        </label>
        <div class="form-grid">
          <label class="form-line">
            <span>水泥用量</span>
            <input v-model="form.cementAmount" placeholder="如 175kg/m³" />
          </label>
          <label class="form-line">
            <span>膨润土用量</span>
            <input v-model="form.bentoniteAmount" placeholder="如 30kg/m³" />
          </label>
          <label class="form-line">
            <span>水灰比（自检）</span>
            <input v-model="form.waterCementRatio" placeholder="0.45–0.70" />
          </label>
          <label class="form-line">
            <span>稠度 mm（自检）</span>
            <input v-model="form.consistency" placeholder="80–100" />
          </label>
          <label class="form-line">
            <span>拌制日期</span>
            <input v-model="form.mixedOn" type="date" />
          </label>
        </div>
        <p class="muted-text">登记按批次编号去重：反复提交只入一条，校验不过不入库。</p>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
          <button class="btn primary" type="submit">提交登记</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { downloadCsv } from '@/api/local-service'
import {
  CURRENT_MORTAR_CRITERIA,
  discardMortarBatch,
  exportMortarLedger,
  listMortarBatches,
  mortarCounts,
  mortarDetailRow,
  registerMortarBatch,
  resolveMortarVerdict,
  startMixing,
  type MortarBatchInput,
} from '@/domain/mortar'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const session = useSessionStore()
const criteria = CURRENT_MORTAR_CRITERIA

const columns = ['批次编号', '浆液类型', '水泥用量', '膨润土用量', '拌制日期', '拌制水灰比', '拌制稠度']
const statuses = ['待拌制', '拌制中', '检验合格', '检验不合格', '已废弃']
const verdictOptions = ['合格（已冻结）', '不合格（已冻结）', '待检验', '已废弃']

const rows = ref<EntryRow[]>([])
const counts = ref(mortarCounts())
const errorMessage = ref('')
const batchNoFilter = ref('')
const verdictFilter = ref('')

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    if (batchNoFilter.value.trim() && !String(row['批次编号'] ?? '').includes(batchNoFilter.value.trim())) {
      return false
    }
    if (verdictFilter.value && resolveMortarVerdict(row).label !== verdictFilter.value) {
      return false
    }
    return true
  }),
)

const showCreate = ref(false)
const formError = ref('')
const form = reactive<MortarBatchInput>({
  batchNo: '',
  mortarType: '同步注浆砂浆',
  cementAmount: '',
  bentoniteAmount: '',
  waterCementRatio: '',
  consistency: '',
  mixedOn: '',
})

function detailOf(row: EntryRow) {
  return mortarDetailRow(row)
}

function verdictOf(row: EntryRow) {
  return resolveMortarVerdict(row)
}

function selfSummary(row: EntryRow): string {
  const checks = resolveMortarVerdict(row).selfChecks
  if (!checks.length) {
    return ''
  }
  const complete = checks.every((item) => item.value !== null)
  if (!complete) {
    return '自检数据不全'
  }
  return checks.every((item) => item.passed) ? '自检在区间内·待复测' : '自检超项·待复测'
}

function selfPass(row: EntryRow): boolean {
  const checks = resolveMortarVerdict(row).selfChecks
  return checks.length > 0 && checks.every((item) => item.passed)
}

function verdictClass(row: EntryRow): string {
  const code = resolveMortarVerdict(row).code
  if (code === 'qualified') {
    return 'tag ok'
  }
  if (code === 'pending') {
    return 'tag info'
  }
  return 'tag bad'
}

function resetFilters() {
  batchNoFilter.value = ''
  verdictFilter.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listMortarBatches()
    counts.value = mortarCounts()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浆液拌制列表读取失败'
  }
}

function exportRows() {
  const ledger = exportMortarLedger()
  downloadCsv(ledger.filename, ledger.content)
}

function openCreate() {
  formError.value = ''
  showCreate.value = true
}

function submitCreate() {
  formError.value = ''
  const result = registerMortarBatch(form, session.operator)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showCreate.value = false
  Object.assign(form, {
    batchNo: '',
    mortarType: '同步注浆砂浆',
    cementAmount: '',
    bentoniteAmount: '',
    waterCementRatio: '',
    consistency: '',
    mixedOn: '',
  })
  errorMessage.value = result.duplicated ? result.message : ''
  reload()
}

function doStartMixing(row: EntryRow) {
  const result = startMixing(Number(row.id))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function doDiscard(row: EntryRow) {
  // 服务层再做一次角色校验：页面绕过（如脚本调用）也越不过这道关。
  const result = discardMortarBatch(Number(row.id), session.operator, session.role)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function denyDiscard() {
  errorMessage.value = `只有拌制站负责人能废弃批次，当前身份「${session.role}」无权操作，已拦截`
}

function goInspection(row?: EntryRow) {
  if (row) {
    router.push({ path: '/testing', query: { batchId: String(row.id) } })
    return
  }
  router.push('/testing')
}

onMounted(reload)
</script>
