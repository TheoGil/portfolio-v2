import "./styles/index.scss";

import { gsap } from "gsap";

import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const items = document.querySelectorAll(".work-item");

const TARGET_POSITION = "center";
const SCROLLER_POSITION = "75%";
const POSITION = `${TARGET_POSITION} ${SCROLLER_POSITION}`;

items.forEach((el, i) => {
  const configuration: ScrollTrigger.StaticVars = {
    trigger: el,
    // markers: true,
    start: POSITION,
    onEnter: () => {
      onToggle(i);
    },
    onEnterBack: () => {
      onToggle(i);
    },
  };

  if (i < items.length - 1) {
    configuration.endTrigger = items[i + 1];
    configuration.end = POSITION;
  }

  ScrollTrigger.create(configuration);
});

function onToggle(i: number) {
  items.forEach((el, j) => {
    gsap.killTweensOf(el);

    const ease = i === j ? "elastic(0.85, 0.75)" : "power3.out";
    const scale = i === j ? 1 : 0;
    const duration = i === j ? 0.75 : 0.5;

    const vars = {
      "--scale": scale,
      ease,
      duration,
      onUpdate: () => {
        ScrollTrigger.refresh();
      },
    };

    gsap.to(el, vars);
  });
}
