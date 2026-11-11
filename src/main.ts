import "./styles/index.scss";

import { gsap } from "gsap";

import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const items = document.querySelectorAll(".work-item");
console.log(items);

items.forEach((el, i) => {
  const videoWrapperEl = el.querySelector(".work-item__video-wrapper");
  const videoEl = el.querySelector(".work-item__video");

  const MULTIPLIER = 1;
  const WRAPPER_DURATION = 0.25 * MULTIPLIER;
  const VIDEO_DURATION_IN = 1.5 * MULTIPLIER;
  const VIDEO_DURATION_OUT = 0.25 * MULTIPLIER;

  const animateIn = () => {
    gsap.killTweensOf(videoWrapperEl);
    gsap.killTweensOf(videoEl);

    gsap.to(videoWrapperEl, {
      "--scale": 1,
      ease: "none",
      duration: WRAPPER_DURATION,
      onUpdate: () => {
        ScrollTrigger.refresh();
      },
    });

    gsap.to(videoEl, {
      "--scale": 1,
      ease: "elastic.out(0.75, 0.75)",
      duration: VIDEO_DURATION_IN,
      onUpdate: () => {
        ScrollTrigger.refresh();
      },
    });
  };

  const animateOut = () => {
    gsap.killTweensOf(videoWrapperEl);
    gsap.killTweensOf(videoEl);

    gsap.to(videoWrapperEl, {
      "--scale": 0,
      ease: "none",
      duration: WRAPPER_DURATION,
      onUpdate: () => {
        ScrollTrigger.refresh();
      },
    });

    gsap.to(videoEl, {
      "--scale": 0,
      ease: "power4.out",
      duration: VIDEO_DURATION_OUT,
      onUpdate: () => {
        ScrollTrigger.refresh();
      },
    });
  };

  const configuration: ScrollTrigger.StaticVars = {
    trigger: el,
    start: "top center",
    markers: true,
    onEnter: animateIn,
    onEnterBack: animateIn,
    onLeaveBack: animateOut,
  };

  if (i < items.length - 1) {
    configuration.endTrigger = items[i + 1];
    configuration.end = "top center";
    configuration.onLeave = animateOut;
  }

  ScrollTrigger.create(configuration);
});
