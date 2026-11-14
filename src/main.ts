import "./styles/index.scss";

import { gsap } from "gsap";

import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const workTitleEl = document.querySelector(".work__title");

const WORKS = {
  items: [] as Element[],
  scrolltriggers: [] as ScrollTrigger[],
  hoverCallbacks: [] as (() => void)[],
  activeItemIndex: null as null | number,
  animateItemIn(i: number) {
    const el = i === 0 ? [this.items[i], workTitleEl] : this.items[i];

    gsap.killTweensOf(el);

    gsap.to(el, {
      "--active": 1,
      ease: "elastic(0.85, 0.75)",
      duration: 0.75,
    });
  },
  animateItemOut(i: number) {
    const el = i === 0 ? [this.items[i], workTitleEl] : this.items[i];

    gsap.killTweensOf(el);

    gsap.to(el, {
      "--active": 0,
      ease: "power3.out",
      duration: 0.25,
    });
  },
  setActive(i: number) {
    if (typeof this.activeItemIndex === "number") {
      this.animateItemOut(this.activeItemIndex);
    }

    this.animateItemIn(i);

    this.activeItemIndex = i;
  },
  enable() {
    this.items = [...document.querySelectorAll(".work-item")];

    const TARGET_POSITION = "center";
    const SCROLLER_POSITION = "75%";
    const POSITION = `${TARGET_POSITION} ${SCROLLER_POSITION}`;

    this.items.forEach((el, i) => {
      const configuration: ScrollTrigger.StaticVars = {
        trigger: el,
        // markers: true,
        start: POSITION,
        onEnter: () => {
          this.setActive(i);
        },
        onEnterBack: () => {
          this.setActive(i);
        },
      };

      if (i === 0) {
        configuration.onLeaveBack = () => {
          if (this.activeItemIndex !== 0) {
            return;
          }

          this.animateItemOut(0);
        };
      }

      if (i < this.items.length - 1) {
        configuration.endTrigger = this.items[i + 1];
        configuration.end = POSITION;
      }

      this.scrolltriggers.push(ScrollTrigger.create(configuration));

      const updateScaleMultiplier = (i: number, progress: number) => {
        const p = 1 - Math.abs(progress * 2 - 1);

        const el = i === 0 ? [this.items[i], workTitleEl] : this.items[i];

        gsap.set(el, {
          "--scale-multiplier": gsap.utils.mapRange(0, 1, 0.8, 1, p).toFixed(4),
        });
      };

      this.scrolltriggers.push(
        ScrollTrigger.create({
          trigger: el,
          start: "center bottom",
          end: "center top",
          onUpdate: (self: ScrollTrigger) => {
            updateScaleMultiplier(i, self.progress);
          },
          onRefresh: (self: ScrollTrigger) => {
            updateScaleMultiplier(i, self.progress);
          },
        }),
      );

      const hoverCallback = () => {
        if (this.activeItemIndex === i) {
          return;
        }

        this.setActive(i);
      };
      el.addEventListener("mouseenter", hoverCallback);
      this.hoverCallbacks.push(hoverCallback);
    });
  },
  disable() {
    this.scrolltriggers.forEach((st) => {
      st.kill();
    });
    this.scrolltriggers = [];

    this.items.forEach((el, i) => {
      gsap.killTweensOf(el);
      el.removeEventListener("mouseenter", this.hoverCallbacks[i]);
    });
    this.hoverCallbacks = [];
  },
};
WORKS.enable();
