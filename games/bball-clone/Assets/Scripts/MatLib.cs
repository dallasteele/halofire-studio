using UnityEngine;

public static class MatLib
{
    static Shader _lit;
    static Shader Lit => _lit ??= Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");

    public static Material Make(Color c, float smoothness = 0.2f, float metallic = 0f)
    {
        var m = new Material(Lit) { color = c };
        if (m.HasProperty("_Color")) m.color = c;
        if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
        if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
        if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
        if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
        return m;
    }

    public static Texture2D WoodTexture(int size = 256)
    {
        var tex = new Texture2D(size, size, TextureFormat.RGB24, true);
        var rng = new System.Random(7);
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float grain = Mathf.PerlinNoise(x * 0.04f, y * 0.6f);
                float band = 0.5f + 0.5f * Mathf.Sin(x * 0.15f + grain * 2.5f);
                float n = (float)rng.NextDouble() * 0.07f;
                float r = Mathf.Clamp01(0.55f * band + 0.2f - n);
                float g = Mathf.Clamp01(0.35f * band + 0.12f - n);
                float b = Mathf.Clamp01(0.18f * band + 0.05f - n);
                tex.SetPixel(x, y, new Color(r, g, b));
            }
        }
        tex.Apply(true);
        tex.wrapMode = TextureWrapMode.Repeat;
        return tex;
    }

    public static Texture2D BallTexture(int size = 128)
    {
        var tex = new Texture2D(size, size, TextureFormat.RGB24, true);
        var orange = new Color(0.85f, 0.42f, 0.13f);
        for (int y = 0; y < size; y++)
        {
            for (int x = 0; x < size; x++)
            {
                float u = (float)x / size;
                float v = (float)y / size;
                bool seamH = Mathf.Abs(v - 0.5f) < 0.012f;
                bool seamV = Mathf.Abs(u - 0.25f) < 0.012f || Mathf.Abs(u - 0.75f) < 0.012f;
                float arcL = Mathf.Abs((u - 0.25f) * (u - 0.25f) + (v - 0.5f) * (v - 0.5f) - 0.04f);
                float arcR = Mathf.Abs((u - 0.75f) * (u - 0.75f) + (v - 0.5f) * (v - 0.5f) - 0.04f);
                bool seamArc = arcL < 0.004f || arcR < 0.004f;
                float n = Mathf.PerlinNoise(x * 0.4f, y * 0.4f) * 0.05f;
                Color c = orange + new Color(n, n * 0.6f, n * 0.2f);
                if (seamH || seamV || seamArc) c = new Color(0.12f, 0.07f, 0.04f);
                tex.SetPixel(x, y, c);
            }
        }
        tex.Apply(true);
        return tex;
    }
}
