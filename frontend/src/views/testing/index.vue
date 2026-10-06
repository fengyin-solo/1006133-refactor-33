<template>
  <section class="page" data-module="testing">
    <header class="page-head">
      <div>
        <h2>试验检测管理</h2>
        <p class="page-desc">浆液检验复测是合格性的唯一裁定入口：复测值按统一判据（{{ criteria.version }}：{{ criteria.note }}）当场复算，结论随批次冻结；试验委托台账在下方维护。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验委托</button>
        <button class="btn" type="button" @click="exportRows">导出试验委托清单</button>
      </div>
    </header>

    <!-- 浆液检验复测：页面自检与导出都不算数，这里复测并冻结 -->
    <section class="sub-panel">
      <header class="sub-head">
        <h3>浆液检验复测</h3>
        <span class="muted-text">同一批次重复提交只保留首条冻结结论；判定依据与导出台账同源</span>
      </header>

      <div class="stat-row">
        <article class="stat-card stat-highlight">
          <span class="stat-label">可投用批次（待用清单）</span>
          <strong class="stat-value">{{ usableCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待复测批次（拌制中）</span>
          <strong class="stat-value">{{ mixableBatches.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已冻结检验记录</span>
          <strong class="stat-value">{{ inspectionRows.length }}</strong>
        </article>
      </div>

      <form class="filter-bar" @submit.prevent="submitInspection">
        <label class="filter-item">
          <span>选择拌制中批次 *</span>
          <select v-model="inspectionForm.batchId">
            <option :value="''">请选择批次</option>
            <option v-for="batch in mixableBatches" :key="String(batch.id)" :value="Number(batch.id)">
              {{ batch['批次编号'] }}（拌制 {{ batch['拌制日期'] }}，自检水灰比 {{ batch['水灰比'] || '—' }} / 稠度 {{ batch['稠度'] || '—' }}）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>复测水灰比 *</span>
          <input v-model="inspectionForm.waterCementRatio" placeholder="0.45–0.70" />
        </label>
        <label class="filter-item">
          <span>复测稠度 mm *</span>
          <input v-model="inspectionForm.consistency" placeholder="80–100" />
        </label>
        <label class="filter-item">
          <span>检验日期</span>
          <input v-model="inspectionForm.inspectedOn" type="date" />
        </label>
        <label class="filter-item">
          <span>检验人员</span>
          <input v-model="inspectionForm.inspector" :placeholder="session.operator" />
        </label>
        <button class="btn primary" type="submit">提交复测</button>
      </form>
      <p v-if="inspectionError" class="error-text">{{ inspectionError }}</p>
      <p v-if="inspectionMessage" class="ok-text">{{ inspectionMessage }}</p>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in inspectionColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="detail in inspectionDetails" :key="String(detail['检验编号'])">
            <td v-for="column in inspectionColumns" :key="column">{{ detail[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!inspectionDetails.length">
            <td :colspan="inspectionColumns.length" class="empty-state">暂无浆液检验记录</td>
          </tr>
        </tbody>
      </table>
    </section>

    <header class="page-head" style="margin-top: 20px">
      <div>
        <h3>试验委托台账</h3>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无试验检测数据，可先登记试验委托</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条试验委托记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  CURRENT_MORTAR_CRITERIA,
  MORTAR_INSPECTION_COLUMNS,
  listMortarBatches,
  listMortarInspections,
  listUsableMortarBatches,
  mortarInspectionDetails,
  submitMortarInspection,
  type MortarInspectionInput,
} from '@/domain/mortar'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('testing')
const columns = ['委托编号', '试样类型', '检测项目', '送样日期', '检测结果', '报告编号', '检测机构', '委托状态']
const actions = ['送样委托', '出具报告', '登记不合格']
const stats = [{ label: '待送样委托', value: 0 }, { label: '检测中委托', value: 0 }, { label: '不合格项', value: 0 }]

const route = useRoute()
const session = useSessionStore()
const criteria = CURRENT_MORTAR_CRITERIA
const inspectionColumns = MORTAR_INSPECTION_COLUMNS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const mortarBatches = ref<EntryRow[]>([])
const inspectionRows = ref<EntryRow[]>([])

const mixableBatches = computed(() =>
  mortarBatches.value.filter((row) => String(row.status) === '拌制中'),
)
const usableCount = computed(() => listUsableMortarBatches().length)
const inspectionDetails = computed(() => mortarInspectionDetails())

const inspectionError = ref('')
const inspectionMessage = ref('')
const inspectionForm = reactive<MortarInspectionInput>({
  batchId: Number(route.query.batchId ?? '') || 0,
  waterCementRatio: '',
  consistency: '',
  inspectedOn: '',
  inspector: '',
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '试验委托登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    mortarBatches.value = listMortarBatches()
    inspectionRows.value = listMortarInspections()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '试验检测列表读取失败'
  }
}

function submitInspection() {
  inspectionError.value = ''
  inspectionMessage.value = ''
  if (!inspectionForm.batchId) {
    inspectionError.value = '请先选择拌制中批次'
    return
  }
  const result = submitMortarInspection(
    { ...inspectionForm, inspector: inspectionForm.inspector || session.operator },
    session.operator,
  )
  if (!result.ok) {
    inspectionError.value = result.message
    return
  }
  inspectionMessage.value = result.message
  inspectionForm.batchId = 0
  inspectionForm.waterCementRatio = ''
  inspectionForm.consistency = ''
  inspectionForm.inspectedOn = ''
  inspectionForm.inspector = ''
  reload()
}

onMounted(reload)
</script>
