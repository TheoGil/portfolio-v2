import "./styles/index.scss";

import { gsap } from "gsap";

import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const WORKS = {
  items: [] as Element[],
  scrolltriggers: [] as ScrollTrigger[],
  activeItemIndex: null as null | number,
  animateItemIn(i: number) {
    const el = this.items[i];

    gsap.killTweensOf(el);

    gsap.to(el, {
      "--scale": 1,
      ease: "elastic(0.85, 0.75)",
      duration: 0.75,
    });
  },
  animateItemOut(i: number) {
    const el = this.items[i];

    gsap.killTweensOf(el);

    gsap.to(el, {
      "--scale": 0,
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
  init() {
    this.items.push(...document.querySelectorAll(".work-item"));

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

      if (i < this.items.length - 1) {
        configuration.endTrigger = this.items[i + 1];
        configuration.end = POSITION;
      }

      this.scrolltriggers.push(ScrollTrigger.create(configuration));

      el.addEventListener("mouseenter", () => {
        if (this.activeItemIndex === i) {
          return;
        }

        this.setActive(i);
      });
    });
  },
};
WORKS.init();
