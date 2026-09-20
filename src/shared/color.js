// 颜色换算(纯数学)

// HSV -> RGB, 返回 [r,g,b] 各 0-255
export function hsv2rgb(h, s, v) {
  var c = h/60, x = v*s*(1-Math.abs(c%2-1));
  var r,g,b;
  if(c<1){r=v;g=x;b=0} else if(c<2){r=x;g=v;b=0} else if(c<3){r=0;g=v;b=x} else if(c<4){r=0;g=x;b=v} else if(c<5){r=x;g=0;b=v} else {r=v;g=0;b=x}
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
