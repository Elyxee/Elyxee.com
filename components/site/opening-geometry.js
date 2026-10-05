// Reconstructed linework in Fire.jpg's 1920 × 1080 coordinates. This is not
// an edge-filtered copy of the painting: only the traveller and the principal
// stone planes remain, so the opening can exist as its own scene in darkness.
const TRAVELLER = 'M735 562 Q744 553 755 557 Q769 553 770 568 L767 582 L763 589 Q777 600 782 616 L794 637 L788 653 L790 701 L796 758 L787 769 L773 767 L760 775 L748 790 L736 791 L738 778 L726 787 L714 789 L712 771 L706 750 L701 724 L708 696 L710 673 L705 651 L711 621 Q720 602 735 589 L731 579 Z';
const STONES = [
  'M0 780 L117 792 L154 818 L176 850 L92 876 L0 880',
  'M117 792 L236 789 L287 803 L340 798 L390 779 L464 778 L497 791',
  'M176 850 L262 827 L321 833 L362 865 L276 906 L157 929 L0 1003',
  'M321 833 L389 806 L456 811 L495 843 L409 889 L362 865',
  'M497 791 L558 781 L612 790 L657 778 L711 775 L744 789 L793 767 L827 775 L860 800 L866 849 L848 891 L846 947 L813 1020 L752 1080',
  'M495 843 L566 819 L629 805 L697 809 L744 789',
  'M566 819 L567 876 L595 929 L580 983 L625 1036 L634 1080',
  'M793 767 L802 825 L776 875 L784 936 L760 987 L751 1066',
  'M409 889 L458 890 L476 932 L505 964 L515 1030 L492 1080',
  'M276 906 L278 967 L338 1009 L354 1080',
  'M157 929 L194 963 L103 1017 L41 1080',
  'M0 1059 L103 1017 L177 1022 L236 1080',
];

export function createOpeningGeometry() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920; canvas.height = 1080;
  const ctx = canvas.getContext('2d');
  // Store channel intensity against opaque black; transparent RGB would turn
  // faint antialiasing and glow pixels into solid outlines in the shader.
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const traveller = new Path2D(TRAVELLER);
  // R: softly feathered spirit volume; B: rock structure.
  ctx.fillStyle = '#ff0000';
  ctx.filter = 'blur(2.5px)';
  ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 18;
  ctx.fill(traveller);
  ctx.shadowBlur = 0; ctx.filter = 'none';
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  function stroke(path, color, width, glow) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.shadowColor = color; ctx.shadowBlur = glow;
    ctx.stroke(typeof path === 'string' ? new Path2D(path) : path);
  }
  STONES.forEach((path,i) => stroke(path, `rgba(0,0,255,${i < 6 ? .35 : .19})`, .9, 3));
  // Broken mineral seams give depth without becoming a glowing wireframe grid.
  stroke('M572 823 L621 817 M701 806 L722 802 M805 784 L832 793 M342 842 L355 858',
    'rgba(0,0,255,.55)', .8, 1);
  return canvas;
}
