import { useEffect } from "react";
import { useSyncStore } from "../stores/syncStore";

/** 挂载同步引擎：监听网络事件、周期性冲刷待同步队列 */
export function useSyncEngine(): void {
  useEffect(() => {
    useSyncStore.getState().setBrowserOnline(navigator.onLine);
    void useSyncStore.getState().flush();

    const handleOnline = () => useSyncStore.getState().setBrowserOnline(true);
    const handleOffline = () => useSyncStore.getState().setBrowserOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // 失败退避后的自动重试由 flush 内的 nextRetryAt 控制
    const timer = window.setInterval(() => {
      void useSyncStore.getState().flush();
    }, 8_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(timer);
    };
  }, []);
}
