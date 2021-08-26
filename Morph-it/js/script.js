Vue.component('drag-node', {
  template: '<circle data-draggable @dragging="onDragging" :cx="absCoord[0]" :cy="absCoord[1]" :r="r" />',
  props: {
    r: { default: 16 },
    coord: Array,
    //If 'coord' is relative to some other point:
    offsetCenter: Array,
  },
  model: {
    prop: 'coord',
    event: 'do_it',
  },
  computed: {
    absCoord() {
      const point = this.coord,
        center = this.offsetCenter,
        absCoord = center ? [point[0] + center[0], point[1] + center[1]]
          : point;
      return absCoord;
    },
  },
  methods: {
    onDragging(e) {
      const point = e.detail.pos,
        center = this.offsetCenter,
        relCoord = center ? [point[0] - center[0], point[1] - center[1]]
          : point;
      this.$emit('do_it', relCoord);
    },
  },
});

Vue.component('connector', {
  template: '<line class="connector" :x1="start[0]" :y1="start[1]" :x2="absEnd[0]" :y2="absEnd[1]" />',
  props: ['start', 'end', 'endIsRel'],
  computed: {
    absEnd() {
      const start = this.start,
        end = this.end,
        absEnd = this.endIsRel ? [start[0] + end[0], start[1] + end[1]]
          : end;
      return absEnd;
    }
  }
});


class Triangulator {
  constructor(size, points) {
    this.size = size;
    this.points = points || [];
  }

  getEffectivePoints() {
    const { w, h } = this.size,
      corners = [
        Triangulator.createPoint([0, 0]),
        Triangulator.createPoint([w, 0]),
        Triangulator.createPoint([0, h]),
        Triangulator.createPoint([w, h])];

    return corners.concat(this.points.filter(p => !p.toDelete));
  }

  getTriangles(indexes) {
    const coords = this.getEffectivePoints().map(p => p.coord),
      triangles = Delaunay.triangulate(coords),
      trisList = [];

    //"...it will return you a giant array, arranged in triplets, 
    //    representing triangles by indices into the passed array."
    let a, b, c;
    for (let i = 0; i < triangles.length; i += 3) {
      if (window.CP.shouldStopExecution(0)) break;
      a = triangles[i];
      b = triangles[i + 1];
      c = triangles[i + 2];
      trisList.push(indexes ? [a, b, c] : [coords[a], coords[b], coords[c]]);
    } window.CP.exitedLoop(0);
    return trisList;
  }

  getEdges() {
    const drawn = {},
      edges = [];

    function addIfNew(p1, p2) {
      var key = p1 < p2 ? p1 + '_' + p2 : p2 + '_' + p1;
      if (drawn[key]) { return; }
      drawn[key] = true;

      edges.push([p1, p2]);
    }

    this.getTriangles().forEach(t => {
      addIfNew(t[0], t[1]);
      addIfNew(t[1], t[2]);
      addIfNew(t[2], t[0]);
    });
    return edges;
  }

  addPoint(coord) {
    this.points.push(Triangulator.createPoint(coord));
  }

  static createPoint(coord) {
    return {
      coord: coord.map(Math.round)
      //toDelete: false,
    };
  }
}






/**
      * Renders an image on a canvas, within a maximum bounding box.
      */
class ImageRenderer {
  constructor(canvas, onImgLoad) {
    this.canvas = canvas;
    const img = this.image = new Image();

    img.addEventListener('load', e => {
      const w = img.naturalWidth,
        h = img.naturalHeight,
        aspect = w / h;

      this.info = {
        width: w,
        height: h,
        aspect
      };

      onImgLoad(this);
    }, false);
  }

  setSrc(src) {
    this.image.src = src;
  }

  clampSize(maxW, maxH) {
    const info = this.info;
    if (!info) { throw new Error(`No size info yet (${this.image.src})`); }

    const w = info.width,
      h = info.height,
      shrinkageW = maxW / w,
      shrinkageH = maxH / h,
      shrinkage = Math.min(shrinkageW, shrinkageH),
      clamped = shrinkage < 1 ? [w * shrinkage, h * shrinkage] : [w, h];

    return clamped;
  }

  render(canvSize) {
    const canvas = this.canvas;
    if (canvSize) {
      canvas.width = canvSize[0];
      canvas.height = canvSize[1];
    }

    const w = canvas.width,
      h = canvas.height,
      [imgW, imgH] = this.clampSize(w, h),
      padW = (w - imgW) / 2,
      padH = (h - imgH) / 2;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.image, padW, padH, imgW, imgH);
  }
}



/**
      * Draws a warped image on a canvas by comparing a normal and a warped triangulation.
      */
function warpImage(img, triSource, triTarget, canvas, lerpT) {
  const um = ABOUtils.Math,
    uc = ABOUtils.Canvas,
    ug = ABOUtils.Geom;

  function drawTriangle(s1, s2, s3, d1, d2, d3) {
    //TODO: Expand dest ~.5, and source similarly based on area difference..
    //Overlap the destination areas a little
    //to avoid hairline cracks when drawing mulitiple connected triangles.
    const [d1x, d2x, d3x] = [d1, d2, d3], //ug.expandTriangle(d1, d2, d3, .3),
      [s1x, s2x, s3x] = [s1, s2, s3]; //ug.expandTriangle(s1, s2, s3, .3);

    uc.drawImageTriangle(img, ctx,
      s1x, s2x, s3x,
      d1x, d2x, d3x, true);
  }

  const { w, h } = triTarget.size,
    ctx = canvas.getContext('2d'),
    tri1 = triSource.getTriangles(true),
    tri2 = triTarget.getTriangles(true),
    co1 = triSource.getEffectivePoints().map(p => p.coord);

  let co2 = triTarget.getEffectivePoints().map(p => p.coord);
  if (lerpT || lerpT === 0) {
    co2 = um.lerp(co1, co2, lerpT);
  }

  ctx.clearRect(0, 0, w, h);
  tri1.forEach((t1, i) => {
    const corners1 = t1.map(i => co1[i]),
      corners2 = t1.map(i => co2[i]);

    drawTriangle(corners1[0], corners1[1], corners1[2],
      corners2[0], corners2[1], corners2[2]);
  });
}


(function () {
  "use strict";
  console.clear();

  const um = ABOUtils.Math,
    ud = ABOUtils.DOM,
    [$, $$] = ud.selectors();


  let _loader1, _loader2;

  const _srcA = './img/img.jpg',
    _srcB = './img/img1.jpg',
    _size = {
      w: 200,
      h: 200
    },

    _maxSize = 300,
    //Global state model. Can be changed from within Vue or from the outside.
    _state = {
      size: _size,
      tri1: new Triangulator(_size, [{ "coord": [53, 77] }, { "coord": [106, 35] }, { "coord": [152, 38] }, { "coord": [238, 56] }, { "coord": [282, 67] }, { "coord": [312, 123] }, { "coord": [271, 122] }, { "coord": [251, 155] }, { "coord": [211, 276] }, { "coord": [216, 318] }, { "coord": [191, 403] }, { "coord": [153, 459] }, { "coord": [92, 90] }, { "coord": [101, 117] }, { "coord": [78, 211] }, { "coord": [56, 222] }, { "coord": [0, 302] }, { "coord": [143, 95] }, { "coord": [229, 111] }, { "coord": [175, 169] }, { "coord": [115, 158] }, { "coord": [118, 212] }, { "coord": [207, 225] }, { "coord": [229, 177] }, { "coord": [59, 113] }, { "coord": [287, 157] }, { "coord": [87, 153] }, { "coord": [247, 188] }, { "coord": [86, 247] }, { "coord": [177, 324] }, { "coord": [122, 384] }, { "coord": [80, 459] }, { "coord": [139, 110] }, { "coord": [228, 125] }]),
      tri2: new Triangulator(_size, [{ "coord": [99, 13] }, { "coord": [129, 35] }, { "coord": [156, 69] }, { "coord": [222, 73] }, { "coord": [261, 33] }, { "coord": [287, 31] }, { "coord": [274, 107] }, { "coord": [264, 146] }, { "coord": [182, 263] }, { "coord": [180, 306] }, { "coord": [120, 385] }, { "coord": [68, 459] }, { "coord": [99, 87] }, { "coord": [98, 119] }, { "coord": [78, 135] }, { "coord": [44, 142] }, { "coord": [0, 150] }, { "coord": [150, 127] }, { "coord": [211, 131] }, { "coord": [175, 169] }, { "coord": [135, 167] }, { "coord": [136, 195] }, { "coord": [210, 200] }, { "coord": [220, 171] }, { "coord": [91, 37] }, { "coord": [288, 64] }, { "coord": [91, 126] }, { "coord": [246, 188] }, { "coord": [97, 181] }, { "coord": [150, 248] }, { "coord": [94, 307] }, { "coord": [51, 459] }, { "coord": [135, 137] }, { "coord": [223, 142] }]),
      selectedIndex: -1
    };



  Vue.component('triangulator', {
    template: `
  <svg :width="size.w" :height="size.h" @click="addPoint">
      <g class="edges">
          <connector class="edge"   v-for="(e, i) in edges"   :start="e[0]" :end="e[1]"></connector>
      </g>
      <g class="nodes">
          <drag-node class="point"  v-for="(p, i) in points"  v-model="p.coord" :class="{ selected: (i === selectedIndex) }" :r="10" :data-index="i"></drag-node>
      </g>
  </svg>`,
    props: ['model', 'selectedIndex'],
    computed: {
      size() { return this.model.size; },
      points() { return this.model.points; },
      edges() { return this.model.getEdges(); }
    },

    mounted() {
      const that = this,
        svg = this.$el,
        deleteThreshold = 20;

      function findPointIndex(node) {
        const index = parseInt(node.dataset.index);
        return index;
      }

      dragTracker({
        container: svg,
        selector: '[data-draggable]',
        propagateEvents: true,
        //dragOutside: false,
        callback: (node, pos) => {
          const x = pos[0],
            y = pos[1],
            point = that.points[findPointIndex(node)];

          let normPos;
          //Drag a point above the canvas to delete:
          if (y < -deleteThreshold) {
            point.toDelete = true;
            normPos = pos;
          } else {
            const w = that.size.w,
              h = that.size.h;
            normPos = [um.clamp(x, 0, w), um.clamp(y, 0, h)];
          }

          //const event = new CustomEvent('dragging', { detail: { pos: nodePos } });
          const event = document.createEvent('CustomEvent');
          event.initCustomEvent('dragging', true, false, { pos: normPos });
          node.dispatchEvent(event);
        },
        callbackDragStart: (node, pos) => {
          that.select(findPointIndex(node));
        },
        callbackDragEnd: (node, pos) => {
          const point = that.points[findPointIndex(node)];
          if (point.toDelete) {
            that.deletePoint(findPointIndex(node));
          }
        }
      });

    },
    methods: {
      addPoint(e) {
        const svg = e.currentTarget;
        if (e.target !== svg) { return; }

        const coord = ud.relativeMousePos(e, svg);
        this.model.addPoint(coord);

        this.$emit('added');
        this.select(this.model.points.length - 1);
      },
      select(index) {
        this.$emit('selected', index);
      },
      deletePoint(index) {
        this.$emit('deleted', index);
      }
    }
  });




  new Vue({
    el: '#app',
    data: {
      state: _state,
      morphAnim: null
    },

    mounted() {
      console.log('main mounted');

      //Handle rendering of the "before" and "after" images.
      function onLoad(loader) {
        const info1 = _loader1.info,
          info2 = _loader2.info;

        //Once we have two images loaded, render both with the same size:
        let size;
        if (info1 && info2) {
          size = _loader1.clampSize(_maxSize, _maxSize);
          _loader1.render(size);
          _loader2.render(size);
        }
        //Render the very first image while we wait for a second one:
        else {
          size = loader.clampSize(_maxSize, _maxSize);
          loader.render(size);
        }

        _size.w = size[0];
        _size.h = size[1];
      }

      [_loader1, _loader2] = $$('.image-container').map(container => {
        const canvas = $('.img', container),
          input = $('input', container),
          loader = new ImageRenderer(canvas, onLoad);

        const onChange = file => {
          loader.setSrc(file.url);
          this.stopAnim();
        };
        ud.dropImage(container, onChange);
        ud.dropImage(input, onChange);

        return loader;
      });

      _loader1.setSrc(_srcA);
      _loader2.setSrc(_srcB);
    },
    methods: {
      sizer() {
        const obj = {
          width: _size.w + 'px',
          height: _size.h + 'px'
        };

        return obj;
      },
      clear() {
        this.state.tri1.points = [];
        this.state.tri2.points = [];
      },
      stopAnim() {
        if (this.morphAnim) { this.morphAnim.cancel(); }
      },
      warp() {
        const c1 = $('#c1'),
          c2 = $('#c2');

        let skip = false;
        function frame(t) {
          //30fps is more than enough:
          skip = !skip;
          if (skip) { return; }

          warpImage(_loader1.canvas, _state.tri1, _state.tri2, c1, t);
          warpImage(_loader2.canvas, _state.tri2, _state.tri1, c2, 1 - t);
          c2.style.opacity = t;
        }

        this.stopAnim();
        this.morphAnim = ud.animate(3000, frame, true);
      },

      //Sync added, selected and deleted points between the two lists:
      onAdded() {
        const a = this.state.tri1,
          b = this.state.tri2,
          [source, target] = a.points.length > b.points.length ? [a, b] : [b, a],
          [sourcePoints, targetPoints] = [source.points, target.points];

        while (targetPoints.length < sourcePoints.length) {
          if (window.CP.shouldStopExecution(1)) break;
          target.addPoint(sourcePoints[targetPoints.length].coord);
        } window.CP.exitedLoop(1);
      },
      onSelected(index) {
        this.stopAnim();
        this.state.selectedIndex = index;
      },
      onDeleted(index) {
        this.$delete(this.state.tri1.points, index);
        this.$delete(this.state.tri2.points, index);
      }
    },

    filters: {
      prettyCompact: function (obj) {
        return 'tri1: new Triangulator(_size, ' + JSON.stringify(obj.tri1.points) + '),\n' +
          'tri2: new Triangulator(_size, ' + JSON.stringify(obj.tri2.points) + '),\n\n';

        if (!obj) return '';
        const pretty = JSON.stringify(obj, null, 2),
          //Collapse simple arrays (arrays without objects or nested arrays) to one line:
          compact = pretty.replace(/\[[^[{]*?]/g, match => match.replace(/\s+/g, ' '));

        return compact;
      }
    }
  });




})();


const burger = document.getElementById('burger');
const ul = document.querySelector('nav ul');

burger.addEventListener('click', () => {
  burger.classList.toggle('show-x');
  ul.classList.toggle('show');
});

