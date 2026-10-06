<template>
  <section class="page" data-module="mortar-inspection">
    <header class="page-head">
      <div>
        <h2>浆液检验入口</h2>
        <p class="page-desc">
          检验结论不再另算一套：统一按集中判据（当前 {{ policy.version }}：稠度 {{ describeBand(policy.consistency) }}、
          水灰比 {{ describeBand(policy.waterCementRatio) }}，稠度为主判栏）由共享引擎给出。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出浆液拌制台账</button>
      </div>
    </header>

    <div class="policy-panel">
      <div>
        <strong>推进判据集中配置</strong>
        <p class="cell-note">{{ policy.note }}</p>
        <p class="cell-note">
          改判据后点「已登记批次重新过一遍」：未定论批次按新判据预检；已定论批次早先结论按当时判据保留，仅追加复判信息。
        </p>
      </div>
      <button class="btn primary" type="button" @click="reapply">已登记批次重新过一遍</button>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待检验（拌制中）</span>
        <strong class="stat-value">{{ pendingViews.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检验合格 / 可投用</span>
        <strong class="stat-value">{{ counts.ready }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检验不合格</span>
        <strong class="stat-value">{{ counts.rejected }}</strong>
      </article>
    </div>

    <h3>待检验批次（明细按统一判据预检）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次编号</th><th>水灰比</th><th>稠度</th><th>拌制日期</th>
          <th>状态</th><th>预检结论</th><th>预检说明</th><th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in pendingViews" :key="item.id">
          <td>{{ item.batchNo }}</td>
          <td>{{ item.waterCementRatio || '—' }}</td>
          <td>{{ item.consistency || '—' }}</td>
          <td>{{ item.mixedDate }}</td>
          <td>{{ item.status }}</td>
          <td><span :class="['tag', tagClass(item.currentPreview.verdict)]">{{ item.currentPreview.verdict }}</span></td>
          <td class="note-cell">{{ item.currentPreview.reason }}</td>
          <td>
            <button class="link" type="button" :disabled="!canInspect" @click="submit(item.id)">
              提交检验
            </button>
            <span v-if="!canInspect" class="cell-note warn">当前角色无权提交检验</span>
          </td>
        </tr>
        <tr v-if="!pendingViews.length">
          <td colspan="8" class="empty-state">没有待检验批次</td>
        </tr>
      </tbody>
    </table>

    <h3 style="margin-top: 18px">已定论批次（结论与明细仅此一份，导出同源）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次编号</th><th>状态</th><th>检验结论</th><th>结论说明</th>
          <th>判据版本</th><th>检验人员</th><th>检验时间</th><th>可投用</th><th>新判据复判</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in concludedViews" :key="item.id">
          <td>{{ item.batchNo }}</td>
          <td><span :class="['tag', statusTagClass(item.status)]">{{ item.status }}</span></td>
          <td><span :class="['tag', tagClass(item.verdictLabel)]">{{ item.verdictLabel }}</span></td>
          <td class="note-cell">{{ item.reason }}</td>
          <td>{{ item.evaluation.policyVersion }}</td>
          <td>{{ item.inspector || '—' }}</td>
          <td>{{ formatTime(item.inspectedAt) }}</td>
          <td>
            <span :class="['tag', item.ready ? 'tag-green' : 'tag-gray']">{{ item.ready ? '是' : '否' }}</span>
          </td>
          <td class="note-cell">
            <template v-if="item.recheckVerdict">
              <span :class="['tag', tagClass(item.recheckVerdict)]">{{ item.recheckVerdict }}</span>
              <span class="cell-note">{{ item.recheckReason }}</span>
            </template>
            <span v-else class="cell-note">—</span>
          </td>
        </tr>
        <tr v-if="!concludedViews.length">
          <td colspan="9" class="empty-state">暂无已定论批次</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>可投用批次 {{ counts.ready }} 批，与同步注浆待用清单是同一个数</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { CURRENT_MORTAR_POLICY, describeBand } from '@/domain/mortar/policy'
import {
  canSubmitInspection,
  CONCLUDED_STATUSES,
  MORTAR_STATUS,
  reapplyPolicy,
  submitInspection,
} from '@/domain/mortar/mortar-service'
import { listBatchViews, mortarCounts, type BatchView } from '@/domain/mortar/mortar-view'
import { downloadMortarLedger } from '@/domain/mortar/mortar-export'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const canInspect = computed(() => canSubmitInspection(store.role))
const policy = CURRENT_MORTAR_POLICY

const views = ref<BatchView[]>([])
const message = ref('')
const messageOk = ref(false)

const pendingViews = computed(() =>
  views.value.filter((item) => item.status === MORTAR_STATUS.mixing || item.status === MORTAR_STATUS.waiting),
)
const concludedViews = computed(() =>
  views.value.filter((item) => CONCLUDED_STATUSES.has(item.status)),
)
const counts = computed(() => mortarCounts(views.value))

function tagClass(verdict: string): string {
  if (verdict === '合格') return 'tag-green'
  if (verdict === '数据不全') return 'tag-gray'
  return 'tag-red'
}

function statusTagClass(status: string): string {
  if (status === MORTAR_STATUS.passed) return 'tag-green'
  return 'tag-red'
}

function formatTime(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function submit(id: number) {
  const result = submitInspection(id, store.role, store.operator)
  message.value = result.message
  messageOk.value = result.ok
  reload()
}

function reapply() {
  const stats = reapplyPolicy()
  message.value = `已按判据 ${stats.version} 重新过一遍：未定论批次重判 ${stats.reevaluated} 条，已定论保留原结论 ${stats.kept} 条`
  messageOk.value = true
  reload()
}

function exportRows() {
  const readyCount = downloadMortarLedger()
  message.value = `台账已导出；其中可投用 ${readyCount} 批`
  messageOk.value = true
}

function reload() {
  views.value = listBatchViews()
}

onMounted(reload)
</script>

<style scoped>
.policy-panel { display: flex; justify-content: space-between; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.tag { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.tag-green { background: #e7f6ec; color: #1a7f37; }
.tag-red { background: #fdecec; color: #b42318; }
.tag-gray { background: #eef2f7; color: #64748b; }
.cell-note { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
.cell-note.warn { color: #b54708; }
.note-cell { max-width: 300px; color: var(--muted); font-size: 12px; }
.ok-text { color: #1a7f37; }
.link:disabled { color: #94a3b8; cursor: not-allowed; }
h3 { font-size: 15px; }
</style>
