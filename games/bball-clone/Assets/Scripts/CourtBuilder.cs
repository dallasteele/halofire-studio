using UnityEngine;

public static class CourtBuilder
{
    public const float Length = 28f;
    public const float Width = 15f;
    public const float ArcRadius = 6.75f;

    public static Transform Build(Transform parent)
    {
        var root = new GameObject("Court").transform;
        root.SetParent(parent);

        var floor = GameObject.CreatePrimitive(PrimitiveType.Cube);
        floor.name = "Floor";
        floor.transform.SetParent(root);
        floor.transform.localScale = new Vector3(Width + 4f, 0.2f, Length + 4f);
        floor.transform.localPosition = new Vector3(0, -0.1f, 0);
        var floorMat = MatLib.Make(Color.white, 0.4f);
        var tex = MatLib.WoodTexture(512);
        if (floorMat.HasProperty("_MainTex")) floorMat.mainTexture = tex;
        if (floorMat.HasProperty("_BaseMap")) floorMat.SetTexture("_BaseMap", tex);
        floorMat.mainTextureScale = new Vector2(8, 14);
        floor.GetComponent<Renderer>().material = floorMat;

        var bounds = new GameObject("OutOfBounds").AddComponent<BoxCollider>();
        bounds.transform.SetParent(root);
        bounds.size = new Vector3(Width, 40f, Length);
        bounds.center = new Vector3(0, 20f, 0);
        bounds.isTrigger = true;
        bounds.gameObject.AddComponent<CourtBounds>();

        DrawLines(root);
        return root;
    }

    static void DrawLines(Transform parent)
    {
        var lineMat = MatLib.Make(Color.white, 0.1f);

        Line(parent, lineMat, new Vector3(-Width / 2, 0.01f, 0), new Vector3(Width / 2, 0.01f, 0), 0.05f);
        Rect(parent, lineMat, Vector3.zero, Width, Length, 0.05f);

        Circle(parent, lineMat, Vector3.zero, 1.8f, 64, 0.05f);

        for (int side = -1; side <= 1; side += 2)
        {
            float baselineZ = side * (Length / 2);
            float keyDepth = 5.8f;
            float keyWidth = 4.9f;
            Rect(parent, lineMat, new Vector3(0, 0.01f, baselineZ - side * keyDepth / 2), keyWidth, keyDepth, 0.05f);

            Vector3 hoopCenter = new Vector3(0, 0.01f, baselineZ - side * 1.575f);
            Arc(parent, lineMat, hoopCenter, ArcRadius, 64, 0.05f, side);

            float cornerZ = baselineZ - side * 4.27f;
            Line(parent, lineMat, new Vector3(-Width / 2 + 0.9f, 0.01f, baselineZ), new Vector3(-Width / 2 + 0.9f, 0.01f, cornerZ), 0.05f);
            Line(parent, lineMat, new Vector3(Width / 2 - 0.9f, 0.01f, baselineZ), new Vector3(Width / 2 - 0.9f, 0.01f, cornerZ), 0.05f);
        }
    }

    static GameObject Line(Transform p, Material m, Vector3 a, Vector3 b, float w)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(go.GetComponent<Collider>());
        go.transform.SetParent(p);
        Vector3 mid = (a + b) * 0.5f;
        float len = Vector3.Distance(a, b);
        go.transform.localPosition = mid + Vector3.up * 0.01f;
        go.transform.localRotation = Quaternion.LookRotation(b - a);
        go.transform.localScale = new Vector3(w, 0.02f, len);
        go.GetComponent<Renderer>().material = m;
        return go;
    }

    static void Rect(Transform p, Material m, Vector3 c, float w, float h, float t)
    {
        Vector3 a = c + new Vector3(-w / 2, 0, -h / 2);
        Vector3 b = c + new Vector3(w / 2, 0, -h / 2);
        Vector3 d = c + new Vector3(w / 2, 0, h / 2);
        Vector3 e = c + new Vector3(-w / 2, 0, h / 2);
        Line(p, m, a, b, t);
        Line(p, m, b, d, t);
        Line(p, m, d, e, t);
        Line(p, m, e, a, t);
    }

    static void Circle(Transform p, Material m, Vector3 c, float r, int seg, float t)
    {
        for (int i = 0; i < seg; i++)
        {
            float a1 = (i / (float)seg) * Mathf.PI * 2f;
            float a2 = ((i + 1) / (float)seg) * Mathf.PI * 2f;
            Vector3 p1 = c + new Vector3(Mathf.Cos(a1) * r, 0, Mathf.Sin(a1) * r);
            Vector3 p2 = c + new Vector3(Mathf.Cos(a2) * r, 0, Mathf.Sin(a2) * r);
            Line(p, m, p1, p2, t);
        }
    }

    static void Arc(Transform p, Material m, Vector3 c, float r, int seg, float t, int side)
    {
        for (int i = 0; i < seg; i++)
        {
            float a1 = Mathf.PI + (i / (float)seg) * Mathf.PI;
            float a2 = Mathf.PI + ((i + 1) / (float)seg) * Mathf.PI;
            Vector3 p1 = c + new Vector3(Mathf.Cos(a1) * r, 0, Mathf.Sin(a1) * r * -side);
            Vector3 p2 = c + new Vector3(Mathf.Cos(a2) * r, 0, Mathf.Sin(a2) * r * -side);
            Line(p, m, p1, p2, t);
        }
    }
}
