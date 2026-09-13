from PIL import Image, ImageDraw

def draw_icon(size, pad_ratio=0.0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(size * pad_ratio)
    r = size // 2 - pad
    cx = cy = size // 2

    bg = (30, 32, 41, 255)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=bg)

    ball_r = int(r * 0.72)
    top_color = (239, 83, 80, 255)
    bottom_color = (241, 242, 246, 255)
    d.pieslice([cx - ball_r, cy - ball_r, cx + ball_r, cy + ball_r], 180, 360, fill=top_color)
    d.pieslice([cx - ball_r, cy - ball_r, cx + ball_r, cy + ball_r], 0, 180, fill=bottom_color)
    band = max(2, int(ball_r * 0.14))
    d.rectangle([cx - ball_r, cy - band // 2, cx + ball_r, cy + band // 2], fill=(20, 21, 28, 255))
    btn_r = int(ball_r * 0.28)
    d.ellipse([cx - btn_r, cy - btn_r, cx + btn_r, cy + btn_r], fill=(20, 21, 28, 255))
    inner_r = int(btn_r * 0.55)
    d.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=(241, 242, 246, 255))
    return img

for size, name, pad in [(192, "icon-192.png", 0.0), (512, "icon-512.png", 0.0), (512, "icon-maskable-512.png", 0.16), (64, "favicon.png", 0.0)]:
    img = draw_icon(size, pad)
    img.save(name)
    print("saved", name)
