<script setup lang="ts">
const open = defineModel<boolean>("open", { default: false });
</script>

<template>
  <UModal
    v-model:open="open"
    title="关于本导播UI程序"
    description="华北电力大学 CS2 导播 UI 说明"
    :dismissible="true"
    :close="true"
    :ui="{
      content: 'max-w-md',
      body: 'p-0',
      footer: 'justify-end',
    }"
  >
    <template #body>
      <div class="bg-elevated/30 p-6">
        <p class="text-sm leading-7 text-muted">
          这是一个由 @NocYnTwoC 开发的 CS2 导播 UI 程序，本人对该 UI
          程序进行了部分调整，使其更适合华北电力大学的 CSer 使用。未来如有学弟想承办华电
          Major，可使用该 UI 程序进行导播。
        </p>
        <p class="mt-4 text-sm leading-7 text-muted">
          原作者仓库链接：
          <a
            class="text-primary underline underline-offset-4"
            href="https://github.com/nsnsay/Zhenhai-HUD-Manager"
            target="_blank"
            rel="noreferrer"
          >
            https://github.com/nsnsay/Zhenhai-HUD-Manager
          </a>
        </p>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton label="Close" color="primary" @click="close" />
    </template>
  </UModal>
</template>

<style scoped lang="scss"></style>
