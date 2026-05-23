using UnityEngine;

public static class PlayerFactory
{
    public static GameObject Build(string name, Color jerseyColor, Color skinColor, Vector3 pos, Transform parent)
    {
        var root = new GameObject(name);
        root.transform.SetParent(parent);
        root.transform.position = pos;

        var body = new GameObject("Body").transform;
        body.SetParent(root.transform, false);

        var torso = GameObject.CreatePrimitive(PrimitiveType.Capsule);
        Object.Destroy(torso.GetComponent<Collider>());
        torso.transform.SetParent(body);
        torso.transform.localPosition = new Vector3(0, 1.0f, 0);
        torso.transform.localScale = new Vector3(0.55f, 0.55f, 0.45f);
        torso.GetComponent<Renderer>().material = MatLib.Make(jerseyColor, 0.2f);

        var shorts = GameObject.CreatePrimitive(PrimitiveType.Cube);
        Object.Destroy(shorts.GetComponent<Collider>());
        shorts.transform.SetParent(body);
        shorts.transform.localPosition = new Vector3(0, 0.55f, 0);
        shorts.transform.localScale = new Vector3(0.58f, 0.35f, 0.5f);
        shorts.GetComponent<Renderer>().material = MatLib.Make(jerseyColor * 0.6f, 0.15f);

        var head = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        Object.Destroy(head.GetComponent<Collider>());
        head.transform.SetParent(body);
        head.transform.localPosition = new Vector3(0, 1.7f, 0);
        head.transform.localScale = Vector3.one * 0.28f;
        head.GetComponent<Renderer>().material = MatLib.Make(skinColor, 0.2f);

        void Limb(string n, Vector3 p, Vector3 s, Color c)
        {
            var l = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Object.Destroy(l.GetComponent<Collider>());
            l.name = n;
            l.transform.SetParent(body);
            l.transform.localPosition = p;
            l.transform.localScale = s;
            l.GetComponent<Renderer>().material = MatLib.Make(c, 0.2f);
        }
        Limb("ArmL", new Vector3(-0.34f, 1.0f, 0), new Vector3(0.13f, 0.55f, 0.13f), skinColor);
        Limb("ArmR", new Vector3(0.34f, 1.0f, 0), new Vector3(0.13f, 0.55f, 0.13f), skinColor);
        Limb("LegL", new Vector3(-0.14f, 0.25f, 0), new Vector3(0.18f, 0.55f, 0.2f), skinColor);
        Limb("LegR", new Vector3(0.14f, 0.25f, 0), new Vector3(0.18f, 0.55f, 0.2f), skinColor);

        var col = root.AddComponent<CapsuleCollider>();
        col.height = 1.9f;
        col.radius = 0.35f;
        col.center = new Vector3(0, 0.95f, 0);

        var rb = root.AddComponent<Rigidbody>();
        rb.mass = 80f;
        rb.angularDrag = 5f;
        rb.drag = 1f;

        var hand = new GameObject("HandAnchor").transform;
        hand.SetParent(root.transform);
        hand.localPosition = new Vector3(0.0f, 1.25f, 0.45f);

        return root;
    }
}
