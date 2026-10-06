<template>
  <section class="page" data-module="grouting">
    <header class="page-head">
      <div>
        <h2>同步注浆管理</h2>
        <p class="page-desc">维护注浆记录，围绕注浆编号、对应环号、浆液配比、注浆量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记注浆记录</button>
        <button class="btn" type="button" @click="exportRows">导出同步注浆清单</button>
      </div>
    </header>

    <!-- 待用浆液清单：直接引用浆液领域的同一口径，拌制页看到几个这里就是几个 -->
    <section class="sub-panel">
      <header class="sub-head">
        <h3>待用浆液清单（可投用批次）</h3>
        <span class="muted-text">与浆液拌制页同源，由检验复测合格后自动进入；判据变更不影响已冻结结论</span>
      </header>
      <div class="stat-row">
        <article class="stat-card stat-highlight">
          <span class="stat-label">可投用批次</span>
          <strong class="stat-value">{{ usableBatches.length }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in readyColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="detail in readyDetails" :key="String(detail['批次编号'])">
            <td v-for="column in readyColumns" :key="column">{{ detail[column] ?? '—' }}</td>
          </tr>
          <tr v-if="!readyDetails.length">
            <td :colspan="readyColumns.length" class="empty-state">暂无可投用浆液批次，合格批次经检验复测后自动出现</td>
          </tr>
        </tbody>
      </table>
    </section>

    <header class="page-head" style="margin-top: 20px">
      <div>
        <h3>注浆记录台账</h3>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
          <td :colspan="columns.length + 2" class="empty-state">暂无同步注浆数据，可先登记注浆记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条同步注浆记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  listUsableMortarBatches,
  mortarDetailRow,
} from '@/domain/mortar'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('grouting')
const columns = ['注浆编号', '对应环号', '浆液配比', '注浆量', '注浆压力', '初凝时间', '注浆班组', '注浆状态']
const actions = ['开始注浆', '确认完成', '安排补浆']
const statuses = ['待注浆', '注浆中', '已完成', '已补浆']
const stats = [{ label: '注浆总量', value: 0 }, { label: '待补浆记录', value: 0 }, { label: '平均注浆压力', value: 0 }]
// 待用清单展示列同样取统一明细拼装，两边不会各算一遍。
const readyColumns = ['批次编号', '浆液类型', '拌制日期', '复测水灰比', '复测稠度', '判定结论', '判定判据']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const usableBatches = ref<EntryRow[]>([])
const readyDetails = computed(() => usableBatches.value.map((row) => mortarDetailRow(row)))

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '注浆记录登记入口尚未接入审批流'
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
    usableBatches.value = listUsableMortarBatches()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '同步注浆列表读取失败'
  }
}

onMounted(reload)
</script>
