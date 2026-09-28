"""Codex가 생성한 스프라이트 시트(assets/raw)를 프레임 단위로 잘라 게임용 스트립(assets/sprites)으로 변환."""
import json, os, sys
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'assets', 'raw')
OUT = os.path.join(ROOT, 'assets', 'sprites')
SCALE = 0.4

# 애니메이션: 이름 -> 프레임 수
ANIMS = {
    'player_walk_sheet': ('player_walk', 4), 'player_idle': ('player_idle', 4),
    'player_attack': ('player_attack', 4), 'player_die': ('player_die', 4),
    'zombie_walk': ('zombie_walk', 4), 'zombie_attack': ('zombie_attack', 4),
    'zombie_die': ('zombie_die', 4), 'boar_walk': ('boar_walk', 4),
    'boar_die': ('boar_die', 4), 'campfire': ('campfire', 4),
}
# 개별 오브젝트: 시트 -> 이름 목록
OBJECTS = {
    'props': ['tree_oak', 'tree_pine', 'rock', 'bush'],
    'items': ['icon_wood', 'icon_stone', 'icon_meat', 'icon_berry', 'icon_cooked', 'icon_heart'],
}


def load(name):
    im = Image.open(os.path.join(RAW, name + '.png')).convert('RGBA')
    a = np.array(im)
    # 흰 배경이면 가장자리에서 flood-fill 로 투명 처리
    if a[2, 2, 3] > 200 and a[2, 2, :3].min() > 225:
        rgb = im.convert('RGB')
        w, h = rgb.size
        for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            ImageDraw.floodfill(rgb, p, (255, 0, 255), thresh=30)
        m = np.all(np.array(rgb) == [255, 0, 255], axis=2)
        a[m, 3] = 0
    a[a[:, :, 3] < 40, 3] = 0
    return a


def split_columns(a, n):
    occ = (a[:, :, 3] > 0).sum(axis=0) > 0
    w = len(occ)
    runs, x = [], 0
    while x < w:
        if not occ[x]:
            s = x
            while x < w and not occ[x]:
                x += 1
            if s > 0 and x < w:
                runs.append((s, x))
        else:
            x += 1
    cuts = []
    for i in range(1, n):
        target = w * i / n
        best = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - target), default=None)
        if best and abs((best[0] + best[1]) / 2 - target) < w / n * 0.45:
            cuts.append((best[0] + best[1]) // 2)
        else:
            cuts.append(int(target))
    return [0] + cuts + [w]


def bbox(a):
    ys, xs = np.nonzero(a[:, :, 3])
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def frame_layers(a, n):
    """연결 요소를 무게중심 x 기준으로 n개 슬롯에 배정 → 칸 경계를 넘는 포즈도 잘리지 않음."""
    mask = ndimage.binary_dilation(a[:, :, 3] > 0, iterations=3)
    lab, cnt = ndimage.label(mask)
    w = a.shape[1]
    slots = [np.zeros(a.shape[:2], bool) for _ in range(n)]
    for i, (sl, c) in enumerate(zip(ndimage.find_objects(lab), ndimage.center_of_mass(mask, lab, range(1, cnt + 1)))):
        comp = lab == i + 1
        if comp.sum() < 400:  # 잡티 제거
            continue
        k = min(n - 1, int(c[1] / (w / n)))
        slots[k] |= comp
    out = []
    for k in range(n):
        f = a.copy()
        f[~slots[k], 3] = 0
        out.append(f)
    return out


def make_anim(src, name, n, meta):
    a = load(src)
    w = a.shape[1]
    frames = []
    for i, sub in enumerate(frame_layers(a, n)):
        bx0, by0, bx1, by1 = bbox(sub)
        cx = w * (i + 0.5) / n  # 슬롯 중심을 기준점으로 유지 (프레임 간 흔들림 방지)
        frames.append((sub, bx0 - cx, bx1 - cx, by0, by1, cx))
    half = max(max(-f[1], f[2]) for f in frames)
    top = min(f[3] for f in frames)
    base = max(f[4] for f in frames)
    cw, ch = int(half * 2) + 2, base - top + 2
    strip = Image.new('RGBA', (cw * n, ch))
    for i, (sub, l, r, t, b, slot_c) in enumerate(frames):
        img = Image.fromarray(sub)
        crop = img.crop((int(slot_c + l), t, int(slot_c + r), b))
        strip.paste(crop, (i * cw + int(cw / 2 + l), t - top), crop)
    strip = strip.resize((max(1, int(strip.width * SCALE)) // n * n, int(strip.height * SCALE)), Image.LANCZOS)
    strip.save(os.path.join(OUT, name + '.png'))
    meta[name] = {'frames': n, 'w': strip.width // n, 'h': strip.height}
    print(name, meta[name])


def make_objects(src, names, meta):
    a = load(src)
    layers = frame_layers(a, len(names))
    for nm, sub in zip(names, layers):
        x0, y0, x1, y1 = bbox(sub)
        img = Image.fromarray(sub).crop((x0, y0, x1, y1))
        img = img.resize((int(img.width * SCALE), int(img.height * SCALE)), Image.LANCZOS)
        img.save(os.path.join(OUT, nm + '.png'))
        meta[nm] = {'frames': 1, 'w': img.width, 'h': img.height}
        print(nm, meta[nm])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for src, (name, n) in ANIMS.items():
        if os.path.exists(os.path.join(RAW, src + '.png')):
            make_anim(src, name, n, meta)
    for src, names in OBJECTS.items():
        make_objects(src, names, meta)
    g = os.path.join(RAW, 'grass.png')
    if os.path.exists(g):
        Image.open(g).convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'grass.png'))
    with open(os.path.join(OUT, 'sprites.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    # 스크립트 태그로도 로드 가능하게 (file:// 에서 fetch 불가 대비)
    with open(os.path.join(OUT, 'sprites.js'), 'w') as f:
        f.write('window.SPRITES = ' + json.dumps(meta) + ';\n')
