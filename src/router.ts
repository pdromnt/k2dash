import { createRouter, createWebHashHistory } from 'vue-router'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    ...['/', '/files', '/printer', '/activity', '/console'].map((path) => ({
      path,
      component: () => import('@/views/DashboardView.vue'),
    })),
  ],
})
