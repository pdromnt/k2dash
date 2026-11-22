import { createRouter, createWebHashHistory } from 'vue-router'
import { workspacePages } from './workspacePages'

export default createRouter({
  history: createWebHashHistory(),
  routes: workspacePages.map(({ id, path }) => ({
    name: id,
    path,
    component: () => import('@/views/DashboardView.vue'),
  })),
})
