import { gsap } from "gsap";

/**
 * plan-web §4 动效实现（GSAP）。规则：只动 transform/opacity；微交互 0.15–0.25s、
 * 入场 0.4–0.6s power3.out；prefers-reduced-motion → duration 0；禁无限 repeat。
 */

function reduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 消息/子项入列：fadeUp 10px 0.25s power2.out（reduced → 直显） */
export function fadeUp(el: Element): void {
  if (reduced()) return;
  gsap.fromTo(el, { y: 10, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.25, ease: "power2.out" });
}

/** 会话面板开合：y(-4→0) + opacity 0.2s power2.out */
export function panelIn(el: Element): void {
  if (reduced()) return;
  gsap.fromTo(el, { y: -4, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.2, ease: "power2.out" });
}

/**
 * 签名动效「弹线绷直」：审批应答后，卡顶 .snap::after 的实线 scaleX 0→1
 * 0.45s power3.out（origin left）。GSAP 不能直接动伪元素——动 CSS 变量，
 * 伪元素 transform 引用变量（index.html 已用 ::after 常规实现，此处兜底直动真元素）。
 */
export function snapReveal(snapEl: Element, denied: boolean): void {
  const solid = snapEl.querySelector(".snap-solid");
  if (reduced() || !solid) return;
  gsap.fromTo(
    solid,
    { scaleX: 0 },
    {
      scaleX: 1,
      duration: 0.45,
      ease: "power3.out",
      transformOrigin: "left center",
      backgroundColor: denied ? "var(--line2)" : "var(--acc)",
    },
  );
}
