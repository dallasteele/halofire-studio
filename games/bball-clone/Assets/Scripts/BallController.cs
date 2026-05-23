using UnityEngine;

[RequireComponent(typeof(Rigidbody), typeof(SphereCollider))]
public class BallController : MonoBehaviour
{
    public const float Radius = 0.12f;
    public Rigidbody Rb { get; private set; }
    public PlayerBase Holder { get; private set; }

    public static BallController Spawn(Vector3 pos)
    {
        var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = "Ball";
        go.transform.localScale = Vector3.one * (Radius * 2f);
        go.transform.position = pos;
        var rb = go.AddComponent<Rigidbody>();
        rb.mass = 0.6f;
        rb.angularDrag = 0.5f;
        rb.drag = 0.05f;
        var mat = MatLib.Make(new Color(0.85f, 0.42f, 0.13f), 0.15f);
        var tex = MatLib.BallTexture(256);
        if (mat.HasProperty("_MainTex")) mat.mainTexture = tex;
        if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
        go.GetComponent<Renderer>().material = mat;
        var col = go.GetComponent<SphereCollider>();
        var physMat = new PhysicMaterial("BallBounce") { bounciness = 0.78f, dynamicFriction = 0.45f, staticFriction = 0.5f, frictionCombine = PhysicMaterialCombine.Average, bounceCombine = PhysicMaterialCombine.Maximum };
        col.material = physMat;
        return go.AddComponent<BallController>();
    }

    void Awake()
    {
        Rb = GetComponent<Rigidbody>();
    }

    public void AttachTo(PlayerBase p)
    {
        Holder = p;
        Rb.isKinematic = true;
        Rb.velocity = Vector3.zero;
        Rb.angularVelocity = Vector3.zero;
        transform.SetParent(p.HandAnchor, false);
        transform.localPosition = Vector3.zero;
    }

    public void Release(Vector3 velocity, Vector3 spin)
    {
        if (Holder != null)
        {
            transform.SetParent(null, true);
            Holder = null;
        }
        Rb.isKinematic = false;
        Rb.velocity = velocity;
        Rb.angularVelocity = spin;
    }

    public void Loose(Vector3 atPos)
    {
        if (Holder != null) { transform.SetParent(null, true); Holder = null; }
        Rb.isKinematic = false;
        transform.position = atPos;
        Rb.velocity = Vector3.zero;
        Rb.angularVelocity = Vector3.zero;
    }

    void Update()
    {
        if (Holder != null) return;
        if (Rb.velocity.sqrMagnitude > 0.04f)
        {
            transform.Rotate(Vector3.Cross(Vector3.up, Rb.velocity).normalized, Rb.velocity.magnitude * 90f * Time.deltaTime, Space.World);
        }
    }

    void OnCollisionEnter(Collision c)
    {
        if (Holder != null) return;
        float v = c.relativeVelocity.magnitude;
        if (v > 1.2f) ProcAudio.I?.PlayBounce(transform.position, Mathf.Clamp01(v / 8f));
    }
}
