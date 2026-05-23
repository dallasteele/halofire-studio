using UnityEngine;

public static class HoopBuilder
{
    public const float Height = 3.05f;
    public const float RimRadius = 0.2286f;
    public const float BackboardWidth = 1.8f;
    public const float BackboardHeight = 1.05f;

    public static Hoop Build(Transform parent, Vector3 position, float yRotation, int teamIndex)
    {
        var root = new GameObject($"Hoop_{teamIndex}").transform;
        root.SetParent(parent);
        root.position = position;
        root.rotation = Quaternion.Euler(0, yRotation, 0);

        var pole = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
        pole.name = "Pole";
        pole.transform.SetParent(root);
        pole.transform.localPosition = new Vector3(0, 2.0f, -0.6f);
        pole.transform.localScale = new Vector3(0.15f, 2.0f, 0.15f);
        pole.GetComponent<Renderer>().material = MatLib.Make(new Color(0.15f, 0.15f, 0.15f), 0.6f, 0.7f);

        var arm = GameObject.CreatePrimitive(PrimitiveType.Cube);
        arm.name = "Arm";
        arm.transform.SetParent(root);
        arm.transform.localPosition = new Vector3(0, Height + 0.05f, -0.3f);
        arm.transform.localScale = new Vector3(0.1f, 0.1f, 0.6f);
        arm.GetComponent<Renderer>().material = MatLib.Make(new Color(0.15f, 0.15f, 0.15f), 0.6f, 0.7f);

        var backboard = GameObject.CreatePrimitive(PrimitiveType.Cube);
        backboard.name = "Backboard";
        backboard.transform.SetParent(root);
        backboard.transform.localPosition = new Vector3(0, Height + 0.15f, 0);
        backboard.transform.localScale = new Vector3(BackboardWidth, BackboardHeight, 0.05f);
        var bbMat = MatLib.Make(new Color(1, 1, 1, 0.85f), 0.9f);
        backboard.GetComponent<Renderer>().material = bbMat;

        var square = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(square.GetComponent<Collider>());
        square.name = "Square";
        square.transform.SetParent(root);
        square.transform.localPosition = new Vector3(0, Height + 0.06f, -0.026f);
        square.transform.localScale = new Vector3(0.59f, 0.45f, 0.005f);
        square.GetComponent<Renderer>().material = MatLib.Make(new Color(0.9f, 0.2f, 0.2f), 0.3f);
        var inner = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(inner.GetComponent<Collider>());
        inner.transform.SetParent(square.transform);
        inner.transform.localPosition = Vector3.zero;
        inner.transform.localScale = new Vector3(0.93f, 0.85f, 0.5f);
        inner.GetComponent<Renderer>().material = MatLib.Make(Color.white, 0.9f);

        BuildRim(root);
        BuildNet(root);

        var trigger = new GameObject("ScoreTrigger");
        trigger.transform.SetParent(root);
        trigger.transform.localPosition = new Vector3(0, Height - 0.05f, 0.3f);
        var col = trigger.AddComponent<BoxCollider>();
        col.isTrigger = true;
        col.size = new Vector3(RimRadius * 1.6f, 0.05f, RimRadius * 1.6f);
        var st = trigger.AddComponent<ScoreTrigger>();

        var hoop = root.gameObject.AddComponent<Hoop>();
        hoop.teamIndex = teamIndex;
        hoop.rimCenter = root.TransformPoint(new Vector3(0, Height, 0.3f));
        hoop.facing = -root.forward;
        st.hoop = hoop;
        return hoop;
    }

    static void BuildRim(Transform parent)
    {
        var rimRoot = new GameObject("Rim").transform;
        rimRoot.SetParent(parent);
        rimRoot.localPosition = new Vector3(0, Height, 0.3f);
        int seg = 24;
        var rimMat = MatLib.Make(new Color(0.95f, 0.45f, 0.05f), 0.5f, 0.6f);
        for (int i = 0; i < seg; i++)
        {
            float a1 = (i / (float)seg) * Mathf.PI * 2f;
            float a2 = ((i + 1) / (float)seg) * Mathf.PI * 2f;
            Vector3 p1 = new Vector3(Mathf.Cos(a1) * RimRadius, 0, Mathf.Sin(a1) * RimRadius);
            Vector3 p2 = new Vector3(Mathf.Cos(a2) * RimRadius, 0, Mathf.Sin(a2) * RimRadius);
            var seg3 = GameObject.CreatePrimitive(PrimitiveType.Cube);
            seg3.transform.SetParent(rimRoot);
            seg3.transform.localPosition = (p1 + p2) * 0.5f;
            seg3.transform.localRotation = Quaternion.LookRotation(p2 - p1);
            seg3.transform.localScale = new Vector3(0.02f, 0.02f, Vector3.Distance(p1, p2));
            seg3.GetComponent<Renderer>().material = rimMat;
        }
    }

    static void BuildNet(Transform parent)
    {
        var netRoot = new GameObject("Net").transform;
        netRoot.SetParent(parent);
        netRoot.localPosition = new Vector3(0, Height - 0.2f, 0.3f);
        var netMat = MatLib.Make(new Color(1, 1, 1, 0.85f), 0.1f);
        int seg = 12;
        for (int i = 0; i < seg; i++)
        {
            float a = (i / (float)seg) * Mathf.PI * 2f;
            Vector3 top = new Vector3(Mathf.Cos(a) * RimRadius, 0.2f, Mathf.Sin(a) * RimRadius);
            Vector3 bot = new Vector3(Mathf.Cos(a) * RimRadius * 0.55f, -0.2f, Mathf.Sin(a) * RimRadius * 0.55f);
            var strand = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Object.Destroy(strand.GetComponent<Collider>());
            strand.transform.SetParent(netRoot);
            strand.transform.localPosition = (top + bot) * 0.5f;
            strand.transform.localRotation = Quaternion.LookRotation(bot - top);
            strand.transform.localScale = new Vector3(0.008f, 0.008f, Vector3.Distance(top, bot));
            strand.GetComponent<Renderer>().material = netMat;
        }
    }
}
